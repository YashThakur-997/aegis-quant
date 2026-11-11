import os
from typing import List

DEFAULT_UNIVERSE: List[str] = [
    # Mega-cap technology
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
    "META",
    "TSLA",
    "AVGO",
    "ORCL",
    "AMD",
    # Financials
    "BRK.B",
    "JPM",
    "V",
    "MA",
    "BAC",
    "WFC",
    "GS",
    "MS",
    # Healthcare
    "UNH",
    "JNJ",
    "LLY",
    "MRK",
    "ABBV",
    "PFE",
    # Energy & industrials
    "XOM",
    "CVX",
    "CAT",
    "GE",
    "BA",
    # Consumer
    "WMT",
    "PG",
    "HD",
    "COST",
    "KO",
    "PEP",
    "DIS",
    # Communications & semis
    "NFLX",
    "CRM",
    "ADBE",
    "CSCO",
    "INTC",
    "QCOM",
    "TXN",
    "MU",
    # High-beta / growth
    "PLTR",
    "UBER",
    # Broad-market ETFs
    "SPY",
    "QQQ",
    "IWM",
    "DIA",
]


def load_universe() -> List[str]:
    """Returns the scan universe: AEGIS_WATCHLIST override or curated defaults."""
    raw = os.getenv("AEGIS_WATCHLIST", "").strip()
    if not raw:
        return list(DEFAULT_UNIVERSE)

    symbols: List[str] = []
    for item in raw.split(","):
        symbol = item.strip().upper()
        if symbol and symbol not in symbols:
            symbols.append(symbol)
    return symbols or list(DEFAULT_UNIVERSE)
