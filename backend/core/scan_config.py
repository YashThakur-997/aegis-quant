import os
from typing import Any, Dict

from backend.core.universe import load_universe


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def load_scan_config() -> Dict[str, Any]:
    """Reads scanner settings from the environment with safe defaults."""
    universe = load_universe()
    batch_size = max(
        1, _env_int("AEGIS_SCAN_BATCH_SIZE", _env_int("AEGIS_SCAN_MAX_TICKERS", 10))
    )
    if universe:
        batch_size = min(batch_size, len(universe))

    return {
        "enabled": _env_bool("AEGIS_SCAN_ENABLED", True),
        "universe": universe,
        "batch_size": batch_size,
        "interval_minutes": max(1, _env_int("AEGIS_SCAN_INTERVAL_MINUTES", 60)),
        "dry_run": _env_bool("AEGIS_SCAN_DRY_RUN", False),
        "skip_held": _env_bool("AEGIS_SCAN_SKIP_HELD", True),
        "market_hours_only": _env_bool("AEGIS_SCAN_MARKET_HOURS_ONLY", True),
        "force": _env_bool("AEGIS_SCAN_FORCE", False),
        "run_once": _env_bool("AEGIS_SCAN_RUN_ONCE", False),
        "run_on_startup": _env_bool("AEGIS_SCAN_RUN_ON_STARTUP", True),
        "ticker_delay_seconds": max(
            0.0, _env_float("AEGIS_SCAN_TICKER_DELAY_SECONDS", 2.0)
        ),
    }
