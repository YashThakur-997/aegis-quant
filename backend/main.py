import json
import logging
import math
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.core.market_data import AlpacaMarketData, AlpacaMarketDataError
from backend.core.pipeline import (
    KillSwitchActive,
    MarketInputPayload,
    broker,
    risk_engine,
    run_pipeline,
)
from backend.core.scan_config import UNIVERSE_MODES, load_scan_config
from backend.core.scan_state import (
    clear_scan_overrides,
    clear_universe_cache,
    get_current_batch,
    get_last_scan,
    get_next_run,
    get_scan_overrides,
    is_paused,
    pause_scans,
    reset_scan_rotation,
    resume_scans,
    save_scan_overrides,
    worker_alive,
)
from backend.core.universe import normalize_symbols, resolve_universe
from backend.database.models import Base, TradeJournalModel
from backend.database.session import engine, get_db

logger = logging.getLogger("aegis")

app = FastAPI(title="Aegis-Quant Autonomous Trading Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_market_data = None


def get_market_data() -> AlpacaMarketData:
    """Lazily builds the Alpaca data client so the API can boot without keys."""
    global _market_data
    if _market_data is None:
        try:
            _market_data = AlpacaMarketData()
        except AlpacaMarketDataError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _market_data


def _safe_market() -> Optional[AlpacaMarketData]:
    try:
        return get_market_data()
    except Exception:
        return None


class ScanConfigUpdate(BaseModel):
    universe_mode: Optional[str] = None
    universe: Optional[List[str]] = None
    universe_size: Optional[int] = None
    universe_min_price: Optional[float] = None
    batch_size: Optional[int] = None
    interval_minutes: Optional[int] = None
    dry_run: Optional[bool] = None
    skip_held: Optional[bool] = None
    market_hours_only: Optional[bool] = None


def _config_response(config: Dict[str, Any]) -> Dict[str, Any]:
    universe, source = resolve_universe(config, _safe_market(), refresh=False)
    overrides = get_scan_overrides()
    return {
        "universe_mode": config["universe_mode"],
        "universe": config["universe"],
        "universe_size": config["universe_size"],
        "universe_min_price": config["universe_min_price"],
        "batch_size": config["batch_size"],
        "interval_minutes": config["interval_minutes"],
        "dry_run": config["dry_run"],
        "skip_held": config["skip_held"],
        "market_hours_only": config["market_hours_only"],
        "resolved_universe": universe,
        "universe_source": source,
        "overrides_active": sorted(overrides.keys()),
    }


def _range(name: str, value: Optional[float], low: float, high: float) -> float:
    if value is None or value < low or value > high:
        raise HTTPException(
            status_code=422,
            detail="%s must be between %s and %s." % (name, low, high),
        )
    return float(value)


def _init_db(retries: int = 10, delay: float = 2.0) -> None:
    """Creates database tables, retrying while Postgres finishes starting up."""
    for attempt in range(1, retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            _migrate_journal_columns()
            logger.info("Database schema ready.")
            return
        except Exception as exc:
            logger.warning("Database not ready (%s/%s): %s", attempt, retries, exc)
            time.sleep(delay)
    logger.error("Could not initialize database schema after %s attempts.", retries)


def _migrate_journal_columns() -> None:
    """Add audit columns for existing demo volumes without destructive migrations."""
    expected = {
        "strategy": "VARCHAR",
        "risk_budget": "FLOAT",
        "broker_mode": "VARCHAR",
        "broker_order_id": "VARCHAR",
        "broker_stop_order_id": "VARCHAR",
        "broker_status": "VARCHAR",
        "broker_response": "TEXT",
    }
    existing = {column["name"] for column in inspect(engine).get_columns("trade_journals")}
    missing = {name: ddl for name, ddl in expected.items() if name not in existing}
    if not missing:
        return
    with engine.begin() as connection:
        for name, ddl in missing.items():
            connection.execute(text(f"ALTER TABLE trade_journals ADD COLUMN {name} {ddl}"))


@app.on_event("startup")
def on_startup() -> None:
    _init_db()


@app.exception_handler(KillSwitchActive)
async def kill_switch_handler(request, exc: KillSwitchActive):
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.post("/api/v1/evaluate-trade")
def evaluate_and_execute_trade(
    payload: MarketInputPayload, db: Session = Depends(get_db)
):
    """Manual/simulation path: the caller supplies all market inputs."""
    return run_pipeline(payload, db)


@app.post("/api/v1/analyze/{ticker}")
def analyze_ticker(
    ticker: str, dry_run: bool = True, db: Session = Depends(get_db)
):
    """Semi-autonomous path: pulls bars, news, and account equity from Alpaca.

    Defaults to a dry run; pass ``dry_run=false`` to submit a paper order.
    """
    symbol = ticker.strip().upper()
    if not symbol:
        raise HTTPException(status_code=422, detail="Ticker is required.")

    if risk_engine.is_kill_switch_active():
        raise HTTPException(
            status_code=403, detail="Circuit breaker active. Trading halted."
        )

    market = get_market_data()
    try:
        bars = market.get_bars(symbol)
        snapshot = market.get_account_snapshot()
        news = market.get_news_summary(symbol)
    except AlpacaMarketDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if len(bars) < 40:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Only {len(bars)} daily bars available for {symbol}; "
                "at least 40 are required."
            ),
        )

    payload = MarketInputPayload(
        ticker=symbol,
        historical_data=bars,
        news_summary=news["summary"],
        current_equity=snapshot["equity"],
        current_daily_pnl=snapshot["daily_pnl_pct"],
        buying_power=snapshot["buying_power"],
    )

    result = run_pipeline(payload, db, dry_run=dry_run)
    result["data_context"] = {
        "ticker": symbol,
        "feed": market.feed_name.upper(),
        "bars_count": len(bars),
        "last_close": bars[-1]["close"],
        "news_count": news["count"],
        "equity": round(snapshot["equity"], 2),
        "daily_pnl_pct": round(snapshot["daily_pnl_pct"] * 100, 4),
        "buying_power": round(snapshot["buying_power"], 2),
        "dry_run": dry_run,
    }
    return result


@app.get("/api/v1/scan/status")
def scan_status():
    """Reports scheduler configuration and the worker's last heartbeat/run."""
    config = load_scan_config()
    market = _safe_market()
    universe, universe_source = resolve_universe(config, market, refresh=False)

    batch = get_current_batch()
    if batch is None:
        size = config["batch_size"] or 0
        count = int(math.ceil(len(universe) / size)) if size else 0
        batch = {
            "tickers": universe[:size],
            "index": 1 if count else 0,
            "count": count,
            "universe_size": len(universe),
        }

    market_open = None
    if market is not None:
        try:
            market_open = market.is_market_open()
        except Exception as exc:  # never fail status because Alpaca is unreachable
            logger.warning("Could not read Alpaca clock for scan status: %s", exc)

    return {
        "enabled": config["enabled"],
        "paused": is_paused(),
        "watchlist": batch["tickers"],
        "universe_size": batch["universe_size"],
        "universe_mode": config["universe_mode"],
        "universe_source": universe_source,
        "batch_index": batch["index"],
        "batch_count": batch["count"],
        "batch_size": config["batch_size"],
        "interval_minutes": config["interval_minutes"],
        "dry_run": config["dry_run"],
        "skip_held": config["skip_held"],
        "market_hours_only": config["market_hours_only"],
        "market_open": market_open,
        "worker_alive": worker_alive(),
        "last_scan": get_last_scan(),
        "next_run_at": get_next_run(),
    }


@app.get("/api/v1/scan/config")
def get_scan_settings():
    """Returns editable scanner settings plus the currently resolved universe."""
    return _config_response(load_scan_config())


@app.put("/api/v1/scan/config")
def update_scan_settings(payload: ScanConfigUpdate):
    """Persists dashboard overrides in Redis; the worker applies them live."""
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return _config_response(load_scan_config())

    if "universe_mode" in updates:
        mode = str(updates["universe_mode"] or "").strip().lower()
        if mode not in UNIVERSE_MODES:
            raise HTTPException(
                status_code=422,
                detail="universe_mode must be one of: %s"
                % ", ".join(UNIVERSE_MODES),
            )
        updates["universe_mode"] = mode

    if "universe" in updates:
        symbols = normalize_symbols(updates["universe"])
        if not symbols:
            raise HTTPException(
                status_code=422, detail="universe must contain at least one symbol."
            )
        if len(symbols) > 100:
            raise HTTPException(
                status_code=422, detail="universe cannot exceed 100 symbols."
            )
        updates["universe"] = symbols

    if "universe_size" in updates:
        updates["universe_size"] = int(
            _range("universe_size", updates["universe_size"], 1, 100)
        )
    if "universe_min_price" in updates:
        updates["universe_min_price"] = _range(
            "universe_min_price", updates["universe_min_price"], 0, 10000
        )
    if "batch_size" in updates:
        updates["batch_size"] = int(
            _range("batch_size", updates["batch_size"], 1, 100)
        )
    if "interval_minutes" in updates:
        updates["interval_minutes"] = int(
            _range("interval_minutes", updates["interval_minutes"], 1, 1440)
        )
    for flag in ("dry_run", "skip_held", "market_hours_only"):
        if flag in updates and updates[flag] is None:
            raise HTTPException(
                status_code=422, detail="%s must be a boolean." % flag
            )

    overrides = get_scan_overrides()
    overrides.update(updates)
    save_scan_overrides(overrides)

    if any(
        key in updates
        for key in (
            "universe",
            "universe_mode",
            "universe_size",
            "universe_min_price",
        )
    ):
        clear_universe_cache()
        reset_scan_rotation()

    return _config_response(load_scan_config())


@app.delete("/api/v1/scan/config")
def reset_scan_settings():
    """Clears dashboard overrides and falls back to env/default settings."""
    clear_scan_overrides()
    clear_universe_cache()
    reset_scan_rotation()
    return _config_response(load_scan_config())


@app.post("/api/v1/scan/universe/refresh")
def refresh_scan_universe():
    """Forces a fresh most-active universe resolution."""
    config = load_scan_config()
    symbols, source = resolve_universe(config, _safe_market(), refresh=True)
    return {"symbols": symbols, "source": source, "count": len(symbols)}


@app.post("/api/v1/scan/pause")
def pause_scan_scheduler():
    """Pauses scheduled scans only; the kill switch still halts all trading."""
    pause_scans()
    return {"paused": True}


@app.post("/api/v1/scan/resume")
def resume_scan_scheduler():
    resume_scans()
    return {"paused": False}


@app.get("/api/v1/trades")
@app.get("/api/v1/journals")
def list_trades(limit: int = 50, db: Session = Depends(get_db)):
    """Returns the most recent trade journal entries."""
    rows = (
        db.query(TradeJournalModel)
        .order_by(TradeJournalModel.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "trade_id": r.trade_id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "action": r.action,
            "ticker": r.ticker,
            "shares": r.shares,
            "allocated_capital": r.allocated_capital,
            "stop_loss_price": r.stop_loss_price,
            "regime": r.regime,
            "conviction": r.conviction,
            "status": r.status,
            "strategy": r.strategy,
            "risk_budget": r.risk_budget,
            "broker_mode": r.broker_mode,
            "broker_order_id": r.broker_order_id,
            "broker_stop_order_id": r.broker_stop_order_id,
            "broker_status": r.broker_status,
            "plain_language_reasoning": r.plain_language_reasoning,
            "bull_catalysts": json.loads(r.bull_catalysts) if r.bull_catalysts else [],
            "bear_risks": json.loads(r.bear_risks) if r.bear_risks else [],
        }
        for r in rows
    ]


@app.get("/api/v1/kill-switch/status")
def kill_switch_status():
    try:
        engaged = risk_engine.is_kill_switch_active()
    except Exception as exc:
        logger.warning("Could not read kill-switch state: %s", exc)
        engaged = False
    return {"engaged": bool(engaged)}


@app.post("/api/v1/kill-switch/trigger")
def manual_kill_switch(reason: str = "Manual override by human operator"):
    risk_engine.trigger_kill_switch(reason)
    cancellations = broker.cancel_open_orders()
    return {
        "status": "CRITICAL_LOCKOUT_ENGAGED",
        "reason": reason,
        "cancellation_result": cancellations,
    }
