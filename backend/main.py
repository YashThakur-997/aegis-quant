import json
import logging
import time
import uuid

import pandas as pd
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.firewall import TemporalFirewall
from backend.core.router import RegimeStrategyRouter
from backend.core.agents import debate_workflow
from backend.core.risk_engine import DeterministicRiskEngine
from backend.core.broker import AlpacaSandboxExecution
from backend.core.market_data import AlpacaMarketData, AlpacaMarketDataError
from backend.database.session import engine, get_db
from backend.database.models import Base, TradeJournalModel

logger = logging.getLogger("aegis")

app = FastAPI(title="Aegis-Quant Autonomous Trading Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize core components
risk_engine = DeterministicRiskEngine(initial_equity=10000.0, daily_loss_limit_pct=0.025)
broker = AlpacaSandboxExecution()
router = RegimeStrategyRouter()

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


class MarketInputPayload(BaseModel):
    ticker: str
    historical_data: list[dict]  # List of OHLCV dicts
    news_summary: str
    current_equity: float
    current_daily_pnl: float


def _journal_trade(
    db: Session,
    *,
    payload: MarketInputPayload,
    signal,
    regime: str,
    status: str,
    shares: int = None,
    allocated_capital: float = None,
    stop_loss_price: float = None,
) -> TradeJournalModel:
    """Persists a decision/trade outcome to the Postgres trade journal."""
    entry = TradeJournalModel(
        trade_id=str(uuid.uuid4()),
        action=signal.direction,
        ticker=payload.ticker,
        shares=shares,
        allocated_capital=allocated_capital,
        stop_loss_price=stop_loss_price,
        regime=regime,
        conviction=signal.conviction,
        plain_language_reasoning=signal.plain_language_reasoning,
        bull_catalysts=json.dumps(signal.bull_catalysts or []),
        bear_risks=json.dumps(signal.bear_risks or []),
        status=status,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def _run_pipeline(payload: MarketInputPayload, db: Session, dry_run: bool = False):
    # 1. Check Kill-Switch first
    if risk_engine.is_kill_switch_active():
        raise HTTPException(status_code=403, detail="Circuit breaker active. Trading halted.")

    df = pd.DataFrame(payload.historical_data)

    # 2. Swimlane 1: Temporal Firewall (Anonymize & Normalize)
    masked_df = TemporalFirewall.anonymize_market_data(df, ticker_alias="ASSET_X")

    # 3. Swimlane 2: Regime Router & VectorBT Validation
    current_regime, _ = router.fit_predict_regime(df)
    vbt_report = router.validate_with_vectorbt(df)

    # 4. Swimlane 3: Adversarial LangGraph Debate
    debate_initial_state = {
        "anonymized_data": masked_df.tail(10).to_string(),
        "news_summary": payload.news_summary,
        "bull_thesis": "",
        "bear_thesis": "",
        "final_signal": None
    }
    debate_result = debate_workflow.invoke(debate_initial_state)
    signal = debate_result["final_signal"]

    if signal.direction == "HOLD":
        journal = _journal_trade(
            db, payload=payload, signal=signal, regime=current_regime, status="HOLD"
        )
        return {
            "status": "HOLD",
            "reason": "LangGraph consensus resulted in HOLD.",
            "trade_id": journal.trade_id,
        }

    # 5. Swimlane 4: Deterministic Risk Guardrails (Kelly Sizing & ATR Stop)
    # Assume mock ATR of 2.5 and Win Rate of 55% with 1.5 Reward-to-Risk ratio for execution
    mock_atr = float(df['high'].iloc[-1] - df['low'].iloc[-1])
    current_price = float(df['close'].iloc[-1])

    risk_assessment = risk_engine.calculate_position_size(
        current_equity=payload.current_equity,
        current_daily_pnl=payload.current_daily_pnl,
        win_rate=0.55,
        reward_risk_ratio=1.5,
        atr=mock_atr,
        price=current_price,
        direction=signal.direction
    )

    if not risk_assessment["approved"]:
        journal = _journal_trade(
            db, payload=payload, signal=signal, regime=current_regime, status="REJECTED"
        )
        return {
            "status": "REJECTED_BY_RISK_ENGINE",
            "details": risk_assessment["reason"],
            "trade_id": journal.trade_id,
        }

    if dry_run:
        journal = _journal_trade(
            db,
            payload=payload,
            signal=signal,
            regime=current_regime,
            status="DRY_RUN",
            shares=risk_assessment["shares"],
            allocated_capital=risk_assessment["allocated_capital"],
            stop_loss_price=risk_assessment["stop_loss_price"],
        )
        return {
            "status": "DRY_RUN",
            "regime": current_regime,
            "vectorbt_validation": vbt_report,
            "trade_signal": signal.dict(),
            "risk_allocation": risk_assessment,
            "broker_execution": {
                "success": True,
                "order_id": None,
                "ticker": payload.ticker.upper(),
                "shares": risk_assessment["shares"],
                "side": signal.direction,
                "status": "DRY_RUN",
            },
            "trade_id": journal.trade_id,
        }

    # 6. Swimlane 5: Alpaca Sandbox Execution & Journaling
    execution_result = broker.execute_paper_order(
        ticker=payload.ticker,
        shares=risk_assessment["shares"],
        side=signal.direction
    )

    journal = _journal_trade(
        db,
        payload=payload,
        signal=signal,
        regime=current_regime,
        status="EXECUTED" if execution_result.get("success") else "REJECTED",
        shares=risk_assessment["shares"],
        allocated_capital=risk_assessment["allocated_capital"],
        stop_loss_price=risk_assessment["stop_loss_price"],
    )

    return {
        "status": "SUCCESS",
        "regime": current_regime,
        "vectorbt_validation": vbt_report,
        "trade_signal": signal.dict(),
        "risk_allocation": risk_assessment,
        "broker_execution": execution_result,
        "trade_id": journal.trade_id,
    }


@app.post("/api/v1/evaluate-trade")
def evaluate_and_execute_trade(
    payload: MarketInputPayload, db: Session = Depends(get_db)
):
    """Manual/simulation path: the caller supplies all market inputs."""
    return _run_pipeline(payload, db)


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

    result = _run_pipeline(payload, db, dry_run=dry_run)
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
