import os
from typing import Any, Dict

from backend.core.scan_state import get_scan_overrides
from backend.core.universe import load_universe, normalize_symbols

UNIVERSE_MODES = ("static", "most_active")


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


def _bool_setting(overrides: Dict[str, Any], key: str, env: str, default: bool) -> bool:
    if key not in overrides or overrides[key] is None:
        return _env_bool(env, default)
    value = overrides[key]
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _int_setting(
    overrides: Dict[str, Any],
    key: str,
    env: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw = overrides.get(key)
    try:
        value = int(raw) if raw is not None else _env_int(env, default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _float_setting(
    overrides: Dict[str, Any],
    key: str,
    env: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    raw = overrides.get(key)
    try:
        value = float(raw) if raw is not None else _env_float(env, default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def load_scan_config() -> Dict[str, Any]:
    """Merges dashboard overrides over environment defaults for the scanner."""
    overrides = get_scan_overrides()

    mode_raw = overrides.get(
        "universe_mode", os.getenv("AEGIS_SCAN_UNIVERSE_MODE", "static")
    )
    universe_mode = str(mode_raw or "static").strip().lower()
    if universe_mode not in UNIVERSE_MODES:
        universe_mode = "static"

    env_universe = load_universe()
    if "universe" in overrides:
        universe = normalize_symbols(overrides.get("universe"))
    else:
        universe = env_universe
    if not universe:
        universe = env_universe

    batch_size = _int_setting(
        overrides,
        "batch_size",
        "AEGIS_SCAN_BATCH_SIZE",
        _env_int("AEGIS_SCAN_MAX_TICKERS", 10),
        1,
        100,
    )
    if universe_mode == "static" and universe:
        batch_size = min(batch_size, len(universe))

    return {
        "enabled": _env_bool("AEGIS_SCAN_ENABLED", True),
        "universe_mode": universe_mode,
        "universe": universe,
        "universe_size": _int_setting(
            overrides,
            "universe_size",
            "AEGIS_SCAN_UNIVERSE_SIZE",
            30,
            1,
            100,
        ),
        "universe_min_price": _float_setting(
            overrides,
            "universe_min_price",
            "AEGIS_SCAN_UNIVERSE_MIN_PRICE",
            10.0,
            0.0,
            10000.0,
        ),
        "batch_size": batch_size,
        "interval_minutes": _int_setting(
            overrides,
            "interval_minutes",
            "AEGIS_SCAN_INTERVAL_MINUTES",
            60,
            1,
            1440,
        ),
        "dry_run": _bool_setting(
            overrides, "dry_run", "AEGIS_SCAN_DRY_RUN", False
        ),
        "skip_held": _bool_setting(
            overrides, "skip_held", "AEGIS_SCAN_SKIP_HELD", True
        ),
        "market_hours_only": _bool_setting(
            overrides,
            "market_hours_only",
            "AEGIS_SCAN_MARKET_HOURS_ONLY",
            True,
        ),
        "force": _env_bool("AEGIS_SCAN_FORCE", False),
        "run_once": _env_bool("AEGIS_SCAN_RUN_ONCE", False),
        "run_on_startup": _env_bool("AEGIS_SCAN_RUN_ON_STARTUP", True),
        "ticker_delay_seconds": max(
            0.0, _env_float("AEGIS_SCAN_TICKER_DELAY_SECONDS", 2.0)
        ),
    }
