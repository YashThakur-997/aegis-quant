import os
import redis
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

# Initialize Redis connection for atomic state tracking and kill-switch
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
r = redis.Redis.from_url(REDIS_URL, decode_responses=True)

class DeterministicRiskEngine:
    """
    Swimlane 4: Deterministic Risk Guardrail Engine (No LLM Math)
    Enforces strict mathematical guardrails, fixed-fractional risk sizing,
    ATR stop-losses, and the Redis circuit breaker.
    """
    def __init__(self, initial_equity: float, daily_loss_limit_pct: float = 0.025):
        self.initial_equity = initial_equity
        self.daily_loss_limit = daily_loss_limit_pct

    def is_kill_switch_active(self) -> bool:
        """Checks if the Redis atomic kill-switch or circuit breaker is engaged[cite: 3, 5, 6]."""
        status = r.get("AEGIS_KILL_SWITCH_ENGAGED")
        return status == "TRUE"

    def trigger_kill_switch(self, reason: str) -> None:
        """
        Atomically records the circuit-breaker state before callers cancel paper orders.
        """
        pipeline = r.pipeline(transaction=True)
        pipeline.set("AEGIS_KILL_SWITCH_ENGAGED", "TRUE")
        pipeline.set("AEGIS_KILL_REASON", reason)
        pipeline.execute()
        logger.critical(f"🚨 CIRCUIT BREAKER ENGAGED: {reason}")

    def calculate_position_size(
        self,
        current_equity: float,
        current_daily_pnl: float,
        buying_power: float,
        atr: float,
        price: float,
        direction: str = "BUY",
        risk_budget_pct: float = 0.02,
        max_position_pct: float = 0.10,
    ) -> Dict[str, Any]:
        """Size a trade from cash at risk, stop distance, and available buying power."""
        # 1. Check if System is Locked Out via Kill-Switch
        if self.is_kill_switch_active():
            return {
                "approved": False, 
                "reason": "Execution blocked: Redis atomic kill-switch or circuit breaker is active."
            }

        # 2. Hard Daily Loss Cap Check (<= -2.5%)
        if current_daily_pnl <= -self.daily_loss_limit:
            self.trigger_kill_switch(f"Daily drawdown limit exceeded: {current_daily_pnl * 100:.2f}%")
            return {
                "approved": False, 
                "reason": "Daily drawdown threshold (-2.5%) breached. Circuit breaker tripped."
            }

        if current_equity <= 0 or buying_power <= 0 or price <= 0 or atr <= 0:
            return {"approved": False, "reason": "Equity, buying power, price, and ATR must be positive."}

        # 3. ATR stop and fixed-fractional sizing. The risk budget is loss at the stop,
        # not the position's notional value.
        if direction.upper() == "BUY":
            stop_loss_price = price - (2.0 * atr)
            take_profit_price = price + (4.0 * atr)
        else:
            stop_loss_price = price + (2.0 * atr)
            take_profit_price = price - (4.0 * atr)
        if stop_loss_price <= 0 or take_profit_price <= 0:
            return {"approved": False, "reason": "Calculated protective exit is invalid."}

        stop_distance = abs(price - stop_loss_price)
        risk_budget = current_equity * risk_budget_pct
        max_position_notional = min(buying_power, current_equity * max_position_pct)
        shares_by_risk = int(risk_budget // stop_distance)
        shares_by_notional = int(max_position_notional // price)
        shares = min(shares_by_risk, shares_by_notional)

        if shares <= 0:
            return {"approved": False, "reason": "Risk budget or buying-power cap cannot fund one share."}

        allocated_capital = shares * price
        actual_risk = shares * stop_distance

        return {
            "approved": True,
            "shares": shares,
            "allocated_capital": round(allocated_capital, 2),
            "risk_budget": round(risk_budget, 2),
            "actual_risk": round(actual_risk, 2),
            "buying_power": round(buying_power, 2),
            "stop_loss_price": round(stop_loss_price, 2),
            "take_profit_price": round(take_profit_price, 2),
            "risk_percentage": round((actual_risk / current_equity) * 100, 2),
            "guardrail_status": "PASSED"
        }
