import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

SCAN_PAUSED_KEY = "aegis:scan:paused"
SCAN_HEARTBEAT_KEY = "aegis:scan:heartbeat"
SCAN_LAST_KEY = "aegis:scan:last"
SCAN_NEXT_KEY = "aegis:scan:next"
SCAN_LOCK_KEY = "aegis:scan:lock"
SCAN_CURSOR_KEY = "aegis:scan:cursor"
SCAN_BATCH_KEY = "aegis:scan:batch"

_client: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    return _client


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_paused() -> bool:
    return get_redis().get(SCAN_PAUSED_KEY) == "TRUE"


def pause_scans() -> None:
    get_redis().set(SCAN_PAUSED_KEY, "TRUE")


def resume_scans() -> None:
    get_redis().delete(SCAN_PAUSED_KEY)


def write_heartbeat(extra: Optional[Dict[str, Any]] = None) -> None:
    payload: Dict[str, Any] = {"at": time.time(), "iso": _now_iso()}
    if extra:
        payload.update(extra)
    get_redis().set(SCAN_HEARTBEAT_KEY, json.dumps(payload))


def heartbeat_age_seconds() -> Optional[float]:
    raw = get_redis().get(SCAN_HEARTBEAT_KEY)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        return max(0.0, time.time() - float(payload["at"]))
    except (ValueError, KeyError, TypeError):
        return None


def worker_alive(max_age_seconds: float = 180.0) -> bool:
    age = heartbeat_age_seconds()
    return age is not None and age <= max_age_seconds


def write_last_scan(summary: Dict[str, Any]) -> None:
    get_redis().set(SCAN_LAST_KEY, json.dumps(summary))


def get_last_scan() -> Optional[Dict[str, Any]]:
    raw = get_redis().get(SCAN_LAST_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def write_next_run(next_run_at: str) -> None:
    get_redis().set(SCAN_NEXT_KEY, next_run_at)


def get_next_run() -> Optional[str]:
    return get_redis().get(SCAN_NEXT_KEY)


def acquire_scan_lock(ttl_seconds: int = 900) -> bool:
    return bool(get_redis().set(SCAN_LOCK_KEY, "1", nx=True, ex=ttl_seconds))


def release_scan_lock() -> None:
    get_redis().delete(SCAN_LOCK_KEY)


def claim_ticker_run(symbol: str, ttl_seconds: int) -> bool:
    return bool(
        get_redis().set(
            "aegis:scan:ticker:%s" % symbol.upper(), "1", nx=True, ex=ttl_seconds
        )
    )


def next_scan_batch(universe: List[str], batch_size: int) -> Dict[str, Any]:
    """Advances the rotation cursor and returns the next slice of the universe."""
    if not universe:
        return {"tickers": [], "index": 0, "count": 0, "universe_size": 0}

    batch_size = max(1, min(batch_size, len(universe)))
    count = (len(universe) + batch_size - 1) // batch_size
    cursor = int(get_redis().incr(SCAN_CURSOR_KEY))
    index = ((cursor - 1) % count) + 1
    start = (index - 1) * batch_size

    batch: Dict[str, Any] = {
        "tickers": universe[start : start + batch_size],
        "index": index,
        "count": count,
        "universe_size": len(universe),
    }
    get_redis().set(SCAN_BATCH_KEY, json.dumps(batch))
    return batch


def get_current_batch() -> Optional[Dict[str, Any]]:
    raw = get_redis().get(SCAN_BATCH_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None
