import json
import logging
import uuid

import pandas as pd
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.agents import debate_workflow
from backend.core.broker import AlpacaSandboxExecution
from backend.core.firewall import TemporalFirewall
from backend.core.risk_engine import DeterministicRiskEngine
from backend.core.router import RegimeStrategyRouter
from backend.database.models import TradeJournalModel

logger = logging.getLogger("aegis.pipeline")

risk_engine = DeterministicRiskEngine(
    initial_equity=10000.0, daily_loss_limit_pct=0.025
)
broker = AlpacaSandboxExecution()


class KillSwitchActive(RuntimeError):
    """Raised when the Redis circuit breaker is engaged."""


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


def run_pipeline(
    payload: MarketInputPayload, db: Session, dry_run: bool = False
) -> dict:
    """Runs the five-swimlane decision pipeline for one market snapshot."""
    # 1. Check Kill-Switch first
    if risk_engine.is_kill_switch_active():
        raise KillSwitchActive("Circuit breaker active. Trading halted.")

    df = pd.DataFrame(payload.historical_data)

    # A fresh router per run keeps the HMM fitted on current data in long-lived workers.
    router = RegimeStrategyRouter()

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
        "final_signal": None,
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
    mock_atr = float(df["high"].iloc[-1] - df["low"].iloc[-1])
    current_price = float(df["close"].iloc[-1])

    risk_assessment = risk_engine.calculate_position_size(
        current_equity=payload.current_equity,
        current_daily_pnl=payload.current_daily_pnl,
        win_rate=0.55,
        reward_risk_ratio=1.5,
        atr=mock_atr,
        price=current_price,
        direction=signal.direction,
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
        side=signal.direction,
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
