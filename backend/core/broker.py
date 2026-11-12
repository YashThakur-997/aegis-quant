import os
import logging
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import GetOrdersRequest, MarketOrderRequest, StopLossRequest, TakeProfitRequest
from alpaca.trading.enums import OrderClass, OrderSide, QueryOrderStatus, TimeInForce

logger = logging.getLogger(__name__)

class AlpacaSandboxExecution:
    """
    Swimlane 5: Sandbox Execution & Audit
    Executes simulated orders via Alpaca Paper Trading API and logs audit trails[cite: 1, 3, 7].
    """
    def __init__(self):
        self.api_key = os.getenv("ALPACA_API_KEY")
        self.secret_key = os.getenv("ALPACA_SECRET_KEY")
        self.base_url = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")
        
        if self.api_key and self.secret_key and "your_alpaca" not in self.api_key:
            self.client = TradingClient(self.api_key, self.secret_key, paper=True)
        else:
            self.client = None
            logger.warning("Alpaca API keys not detected. Running broker in offline mock execution mode.")

    def execute_paper_order(
        self, ticker: str, shares: int, side: str, stop_loss_price: float, take_profit_price: float
    ) -> dict:
        """Submit a paper-only bracket order with a broker-managed protective stop."""
        if shares <= 0:
            return {"success": False, "error": "Share volume is zero; order skipped."}
        if stop_loss_price <= 0:
            return {"success": False, "error": "Protective stop price must be positive."}
        if take_profit_price <= 0:
            return {"success": False, "error": "Take-profit price must be positive."}

        order_side = OrderSide.BUY if side.upper() == "BUY" else OrderSide.SELL

        if not self.client:
            return {
                "success": True,
                "mode": "SIMULATED",
                "order_id": None,
                "stop_order_id": None,
                "ticker": ticker,
                "shares": shares,
                "side": side,
                "status": "SIMULATED_NOT_SUBMITTED",
                "protective_stop_price": stop_loss_price,
                "protective_stop_attached": True,
                "take_profit_price": take_profit_price,
            }

        try:
            market_order_data = MarketOrderRequest(
                symbol=ticker,
                qty=shares,
                side=order_side,
                time_in_force=TimeInForce.GTC,
                order_class=OrderClass.BRACKET,
                stop_loss=StopLossRequest(stop_price=stop_loss_price),
                take_profit=TakeProfitRequest(limit_price=take_profit_price),
            )
            order = self.client.submit_order(order_data=market_order_data)
            legs = list(getattr(order, "legs", None) or [])
            stop_leg = next(
                (leg for leg in legs if str(getattr(leg, "type", "")).lower() == "stop"),
                None,
            )
            return {
                "success": True,
                "mode": "PAPER_ALPACA",
                "order_id": str(order.id),
                "stop_order_id": str(stop_leg.id) if stop_leg and getattr(stop_leg, "id", None) else None,
                "ticker": ticker,
                "shares": shares,
                "side": side,
                "status": str(order.status),
                "protective_stop_price": stop_loss_price,
                "protective_stop_attached": True,
                "take_profit_price": take_profit_price,
            }
        except Exception as e:
            logger.error(f"Alpaca paper order execution failed: {str(e)}")
            return {"success": False, "error": str(e)}

    def cancel_open_orders(self) -> dict:
        """Cancel every currently open paper order after a human or risk lockout."""
        if not self.client:
            return {
                "mode": "SIMULATED",
                "attempted": 0,
                "cancelled": 0,
                "failures": [],
            }
        try:
            orders = self.client.get_orders(
                filter=GetOrdersRequest(status=QueryOrderStatus.OPEN)
            )
            failures = []
            cancelled = 0
            for order in orders:
                try:
                    self.client.cancel_order_by_id(order.id)
                    cancelled += 1
                except Exception as exc:  # report individual failures without skipping others
                    failures.append({"order_id": str(order.id), "error": str(exc)})
            return {
                "mode": "PAPER_ALPACA",
                "attempted": len(orders),
                "cancelled": cancelled,
                "failures": failures,
            }
        except Exception as exc:
            logger.error("Could not cancel open Alpaca paper orders: %s", exc)
            return {"mode": "PAPER_ALPACA", "attempted": 0, "cancelled": 0, "failures": [{"error": str(exc)}]}
