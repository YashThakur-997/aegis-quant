"""Deterministic paper-trading fixture for the hackathon safety demo."""

from __future__ import annotations

from datetime import date, timedelta
from math import sin


def nvda_fixture() -> dict:
    """Return reproducible OHLCV data with no external market-data dependency."""
    start = date(2026, 1, 2)
    price = 120.0
    bars = []
    for index in range(120):
        open_price = price
        close = max(1.0, open_price * (1.002 + sin(index / 6) * 0.006))
        bars.append(
            {
                "timestamp": (start + timedelta(days=index)).isoformat(),
                "open": round(open_price, 2),
                "high": round(max(open_price, close) * 1.01, 2),
                "low": round(min(open_price, close) * 0.99, 2),
                "close": round(close, 2),
                "volume": 1_200_000 + index * 1_000,
            }
        )
        price = close
    return {
        "ticker": "NVDA",
        "news_summary": "Deterministic demo fixture: earnings resilience and semiconductor demand.",
        "current_equity": 10_000,
        "buying_power": 10_000,
        "current_daily_pnl": 0.0,
        "historical_data": bars,
    }


if __name__ == "__main__":
    import json

    print(json.dumps(nvda_fixture(), indent=2))
