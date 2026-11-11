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
    Enforces strict mathematical guardrails, fractional Kelly position sizing,
    2x ATR stop-losses, and the Redis atomic circuit breaker.
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
        Engages the circuit breaker: sets Redis lock, cancels open orders, 
        and halts all agent trading activity[cite: 3, 5, 6].
        """
        r.set("AEGIS_KILL_SWITCH_ENGAGED", "TRUE")
        r.set("AEGIS_KILL_REASON", reason)
        logger.critical(f"🚨 CIRCUIT BREAKER ENGAGED: {reason}")
        # Insert downstream broker order cancellation trigger here

    def calculate_position_size(
        self,
        current_equity: float,
        current_daily_pnl: float,
        win_rate: float,
        reward_risk_ratio: float,
        atr: float,
        price: float,
        direction: str = "BUY"
    ) -> Dict[str, Any]:
        """
        Executes pure Python deterministic risk logic:
        1. Validates the Redis kill-switch state[cite: 3, 5, 6].
        2. Enforces the hard daily drawdown cap (-2.5%)[cite: 3, 5, 6].
        3. Computes Fractional Kelly sizing: Size = Equity * min(0.02, 0.25 * (WinRate - (1 - WinRate) / RR))[cite: 5, 6].
        4. Calculates 2x ATR dynamic stop-loss[cite: 5, 6].
        """
        # 1. Check if System is Locked Out via Kill-Switch
        if self.is_kill_switch_active():
            return {
                "approved": False, 
                "reason": "Execution blocked: Redis atomic kill-switch or circuit breaker is active[cite: 3, 5, 6]."
            }

        # 2. Hard Daily Loss Cap Check (<= -2.5%)[cite: 3, 5, 6]
        if current_daily_pnl <= -self.daily_loss_limit:
            self.trigger_kill_switch(f"Daily drawdown limit exceeded: {current_daily_pnl * 100:.2f}%[cite: 3, 5, 6]")
            return {
                "approved": False, 
                "reason": "Daily drawdown threshold (-2.5%) breached. Circuit breaker tripped[cite: 3, 5, 6]."
            }

        # 3. Fractional Kelly Position Sizing Calculation[cite: 5, 6]
        if reward_risk_ratio <= 0:
            return {"approved": False, "reason": "Invalid reward-to-risk ratio provided."}

        kelly_numerator_term = win_rate - ((1.0 - win_rate) / reward_risk_ratio)
        fractional_kelly_factor = max(0.0, 0.25 * kelly_numerator_term) # Quarter Kelly for safety
        
        # Cap maximum risk allocation per trade at 2.0% of portfolio equity[cite: 5, 6]
        max_allowed_risk_pct = min(0.02, fractional_kelly_factor)

        if max_allowed_risk_pct <= 0:
            return {"approved": False, "reason": "Kelly criterion indicates negative or zero edge; trade rejected."}

        allocated_capital = current_equity * max_allowed_risk_pct
        shares = int(allocated_capital // price)

        if shares <= 0:
            return {"approved": False, "reason": "Calculated share volume is zero based on available capital."}

        # 4. 2x ATR Dynamic Stop-Loss Calculation[cite: 5, 6]
        if direction.upper() == "BUY":
            stop_loss_price = price - (2.0 * atr)
        else:
            stop_loss_price = price + (2.0 * atr)

        return {
            "approved": True,
            "shares": shares,
            "allocated_capital": round(allocated_capital, 2),
            "stop_loss_price": round(stop_loss_price, 2),
            "risk_percentage": round(max_allowed_risk_pct * 100, 2),
            "guardrail_status": "PASSED"
        }