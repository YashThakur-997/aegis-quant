import json
import logging
import math
import time

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.core.market_data import AlpacaMarketData, AlpacaMarketDataError
from backend.core.pipeline import (
    KillSwitchActive,
    MarketInputPayload,
    risk_engine,
    run_pipeline,
)
from backend.core.scan_config import load_scan_config
from backend.core.scan_state import (
    get_current_batch,
    get_last_scan,
    get_next_run,
    is_paused,
    pause_scans,
    resume_scans,
    worker_alive,
)
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


def _init_db(retries: int = 10, delay: float = 2.0) -> None:
    """Creates database tables, retrying while Postgres finishes starting up."""
    for attempt in range(1, retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("Database schema ready.")
            return
        except Exception as exc:
            logger.warning("Database not ready (%s/%s): %s", attempt, retries, exc)
            time.sleep(delay)
    logger.error("Could not initialize database schema after %s attempts.", retries)


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
        "dry_run": dry_run,
    }
    return result


@app.get("/api/v1/scan/status")
def scan_status():
    """Reports scheduler configuration and the worker's last heartbeat/run."""
    config = load_scan_config()

    batch = get_current_batch()
    if batch is None:
        universe = config["universe"]
        size = config["batch_size"] or 0
        count = int(math.ceil(len(universe) / size)) if size else 0
        batch = {
            "tickers": universe[:size],
            "index": 1 if count else 0,
            "count": count,
            "universe_size": len(universe),
        }

    market_open = None
    try:
        market_open = get_market_data().is_market_open()
    except Exception as exc:  # never fail status because Alpaca is unreachable
        logger.warning("Could not read Alpaca clock for scan status: %s", exc)

    return {
        "enabled": config["enabled"],
        "paused": is_paused(),
        "watchlist": batch["tickers"],
        "universe_size": batch["universe_size"],
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
            "plain_language_reasoning": r.plain_language_reasoning,
            "bull_catalysts": json.loads(r.bull_catalysts) if r.bull_catalysts else [],
            "bear_risks": json.loads(r.bear_risks) if r.bear_risks else [],
        }
        for r in rows
    ]


@app.post("/api/v1/kill-switch/trigger")
def manual_kill_switch(reason: str = "Manual override by human operator"):
    risk_engine.trigger_kill_switch(reason)
    return {"status": "CRITICAL_LOCKOUT_ENGAGED", "reason": reason}
