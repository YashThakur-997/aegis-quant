import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from backend.core.scan_state import get_universe_cache, write_universe_cache

logger = logging.getLogger(__name__)

UNIVERSE_CACHE_TTL_SECONDS = 900

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


def normalize_symbols(values: Any) -> List[str]:
    """Normalizes a list or comma/newline-separated string into unique tickers."""
    if values is None:
        return []
    if isinstance(values, str):
        parts: Iterable[Any] = values.replace("\n", ",").split(",")
    elif isinstance(values, (list, tuple, set)):
        parts = values
    else:
        return []

    symbols: List[str] = []
    for item in parts:
        symbol = str(item).strip().upper()
        if not symbol:
            continue
        if len(symbol) > 10:
            continue
        if symbol not in symbols:
            symbols.append(symbol)
    return symbols


def load_universe() -> List[str]:
    """Returns the static scan universe: AEGIS_WATCHLIST override or defaults."""
    raw = os.getenv("AEGIS_WATCHLIST", "").strip()
    if not raw:
        return list(DEFAULT_UNIVERSE)

    symbols = normalize_symbols(raw)
    return symbols or list(DEFAULT_UNIVERSE)


def _cache_params(config: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "top": int(config.get("universe_size", 30)),
        "min_price": float(config.get("universe_min_price", 10.0)),
        "by": "trades",
    }


def resolve_universe(
    config: Dict[str, Any],
    market: Optional[Any] = None,
    refresh: bool = False,
) -> Tuple[List[str], str]:
    """Resolves the active universe and reports where it came from.

    Static mode uses the dashboard/env list. ``most_active`` mode uses Alpaca's
    most-active screener, cached in Redis so status polling never hammers Alpaca.
    """
    static = normalize_symbols(config.get("universe")) or list(DEFAULT_UNIVERSE)
    if config.get("universe_mode") != "most_active":
        return static, "static"

    params = _cache_params(config)
    cache = get_universe_cache()
    cache_symbols = (
        normalize_symbols(cache.get("symbols")) if isinstance(cache, dict) else []
    )
    cache_matches = bool(
        cache
        and cache.get("mode") == "most_active"
        and cache.get("params") == params
        and cache_symbols
    )
    try:
        cache_age = (
            max(0.0, time.time() - float(cache.get("at", 0)))
            if cache_matches
            else None
        )
    except (TypeError, ValueError):
        cache_age = None

    if (
        cache_matches
        and not refresh
        and cache_age is not None
        and cache_age < UNIVERSE_CACHE_TTL_SECONDS
    ):
        return cache_symbols, "most-active (cached)"

    if market is not None:
        try:
            symbols = market.get_most_active_symbols(
                top=params["top"],
                min_price=params["min_price"],
                by=params["by"],
            )
            if symbols:
                write_universe_cache(
                    {
                        "symbols": symbols,
                        "mode": "most_active",
                        "params": params,
                        "at": time.time(),
                        "iso": datetime.now(timezone.utc).isoformat(),
                    }
                )
                return symbols, "most-active"
            logger.warning("Most-active universe returned no symbols.")
        except Exception as exc:  # fall back rather than break the sweep
            logger.warning("Could not resolve most-active universe: %s", exc)

    if cache_matches:
        return cache_symbols, "most-active (stale cache)"
    return static, "fallback"
