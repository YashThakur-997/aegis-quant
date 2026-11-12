import json
import logging
import uuid
from typing import Optional

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
    buying_power: Optional[float] = None


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
    strategy: str = None,
    risk_budget: float = None,
    execution_result: dict = None,
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
        strategy=strategy,
        risk_budget=risk_budget,
        broker_mode=(execution_result or {}).get("mode"),
        broker_order_id=(execution_result or {}).get("order_id"),
        broker_stop_order_id=(execution_result or {}).get("stop_order_id"),
        broker_status=(execution_result or {}).get("status"),
        broker_response=json.dumps(execution_result) if execution_result else None,
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

    # 3. Swimlane 2: Regime router, deterministic strategy, and next-bar validation.
    current_regime, _ = router.fit_predict_regime(df)
    strategy = router.strategy_for_regime(current_regime)
    vbt_report = router.walk_forward_validate(df, strategy)
    deterministic_direction = router.deterministic_action(df, strategy)

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

    # The LLM may explain or veto a deterministic entry. It cannot create one.
    if vbt_report.get("validation_status") != "PASSED":
        signal = signal.model_copy(update={
            "direction": "HOLD",
            "plain_language_reasoning": (
                f"{strategy} is blocked because walk-forward validation status is "
                f"{vbt_report.get('validation_status')}. LLM review: {signal.plain_language_reasoning}"
            ),
        })
    elif deterministic_direction != "BUY":
        signal = signal.model_copy(update={
            "direction": "HOLD",
            "plain_language_reasoning": (
                f"{strategy} selected HOLD from completed-bar rules. "
                f"LLM review: {signal.plain_language_reasoning}"
            ),
        })
    elif signal.direction != "BUY":
        signal = signal.model_copy(update={
            "direction": "HOLD",
            "plain_language_reasoning": (
                f"{strategy} proposed BUY, but the LLM risk review vetoed entry. "
                f"{signal.plain_language_reasoning}"
            ),
        })

    if signal.direction == "HOLD":
        journal = _journal_trade(
            db, payload=payload, signal=signal, regime=current_regime, status="HOLD", strategy=strategy
        )
        return {
            "status": "HOLD",
            "reason": "Deterministic policy held or LLM risk review vetoed the trade.",
            "regime": current_regime,
            "strategy": strategy,
            "vectorbt_validation": vbt_report,
            "trade_signal": signal.dict(),
            "trade_id": journal.trade_id,
        }

    # 5. Swimlane 4: deterministic cash-risk sizing and ATR protective exits.
    atr = router.calculate_atr(df)
    current_price = float(df["close"].iloc[-1])

    risk_assessment = risk_engine.calculate_position_size(
        current_equity=payload.current_equity,
        current_daily_pnl=payload.current_daily_pnl,
        buying_power=payload.buying_power or payload.current_equity,
        atr=atr,
        price=current_price,
        direction=signal.direction,
    )

    if not risk_assessment["approved"]:
        cancellations = None
        if current_daily_pnl <= -risk_engine.daily_loss_limit:
            cancellations = broker.cancel_open_orders()
        journal = _journal_trade(
            db, payload=payload, signal=signal, regime=current_regime, status="REJECTED",
            strategy=strategy, execution_result=cancellations,
        )
        return {
            "status": "REJECTED_BY_RISK_ENGINE",
            "details": risk_assessment["reason"],
            "regime": current_regime,
            "strategy": strategy,
            "vectorbt_validation": vbt_report,
            "risk_allocation": risk_assessment,
            "cancellation_result": cancellations,
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
            strategy=strategy,
            risk_budget=risk_assessment["risk_budget"],
        )
        return {
            "status": "DRY_RUN",
            "regime": current_regime,
            "strategy": strategy,
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
        stop_loss_price=risk_assessment["stop_loss_price"],
        take_profit_price=risk_assessment["take_profit_price"],
    )

    journal = _journal_trade(
        db,
        payload=payload,
        signal=signal,
        regime=current_regime,
        status="PAPER_SUBMITTED" if execution_result.get("success") and execution_result.get("mode") == "PAPER_ALPACA" else ("SIMULATED" if execution_result.get("success") else "REJECTED"),
        shares=risk_assessment["shares"],
        allocated_capital=risk_assessment["allocated_capital"],
        stop_loss_price=risk_assessment["stop_loss_price"],
        strategy=strategy,
        risk_budget=risk_assessment["risk_budget"],
        execution_result=execution_result,
    )

    return {
        "status": "PAPER_SUBMITTED" if execution_result.get("mode") == "PAPER_ALPACA" else ("SIMULATED" if execution_result.get("success") else "REJECTED"),
        "regime": current_regime,
        "strategy": strategy,
        "vectorbt_validation": vbt_report,
        "trade_signal": signal.dict(),
        "risk_allocation": risk_assessment,
        "broker_execution": execution_result,
        "trade_id": journal.trade_id,
    }
