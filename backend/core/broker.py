import os
import logging
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

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

    def execute_paper_order(self, ticker: str, shares: int, side: str) -> dict:
        """Submits a paper trading order to Alpaca sandbox or returns a mock success payload."""
        if shares <= 0:
            return {"success": False, "error": "Share volume is zero; order skipped."}

        order_side = OrderSide.BUY if side.upper() == "BUY" else OrderSide.SELL

        if not self.client:
            return {
                "success": True,
                "order_id": "mock-order-aegis-998",
                "ticker": ticker,
                "shares": shares,
                "side": side,
                "status": "FILLED_SIMULATED"
            }

        try:
            market_order_data = MarketOrderRequest(
                symbol=ticker,
                qty=shares,
                side=order_side,
                time_in_force=TimeInForce.GTC
            )
            order = self.client.submit_order(order_data=market_order_data)
            return {
                "success": True,
                "order_id": str(order.id),
                "ticker": ticker,
                "shares": shares,
                "side": side,
                "status": str(order.status)
            }
        except Exception as e:
            logger.error(f"Alpaca paper order execution failed: {str(e)}")
            return {"success": False, "error": str(e)}