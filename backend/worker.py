import logging
import signal
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger

from backend.core.market_data import AlpacaMarketData, AlpacaMarketDataError
from backend.core.pipeline import (
    KillSwitchActive,
    MarketInputPayload,
    risk_engine,
    run_pipeline,
)
from backend.core.scan_config import load_scan_config
from backend.core.scan_state import (
    acquire_scan_lock,
    claim_ticker_run,
    is_paused,
    next_scan_batch,
    release_scan_lock,
    write_heartbeat,
    write_last_scan,
    write_next_run,
)
from backend.core.universe import resolve_universe
from backend.database.session import SessionLocal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("aegis.worker")

TIMEZONE = "America/New_York"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _skipped(started: str, reason: str) -> Dict[str, Any]:
    summary = {
        "started_at": started,
        "finished_at": _iso_now(),
        "skipped": reason,
        "results": [],
    }
    write_last_scan(summary)
    return summary


def run_scan(
    config: Optional[Dict[str, Any]] = None,
    market: Optional[AlpacaMarketData] = None,
) -> Dict[str, Any]:
    """Runs one watchlist sweep: fetch data, run the pipeline, journal results."""
    config = config or load_scan_config()
    market = market or AlpacaMarketData()
    started = _iso_now()

    if not config["enabled"]:
        logger.info("Scan skipped: scanner disabled")
        return _skipped(started, "scanner disabled")

    if is_paused():
        logger.info("Scan skipped: scanner paused")
        return _skipped(started, "scanner paused")

    if risk_engine.is_kill_switch_active():
        logger.warning("Scan skipped: kill switch active")
        return _skipped(started, "kill switch active")

    if config["market_hours_only"] and not config["force"]:
        try:
            market_open = market.is_market_open()
        except AlpacaMarketDataError as exc:
            logger.warning("Scan skipped, clock unavailable: %s", exc)
            return _skipped(started, "clock error: %s" % exc)
        if not market_open:
            logger.info("Scan skipped: market closed")
            return _skipped(started, "market closed")

    lock_ttl = max(900, config["interval_minutes"] * 60)
    if not acquire_scan_lock(ttl_seconds=lock_ttl):
        logger.info("Scan skipped: another scan is running")
        return _skipped(started, "another scan is running")

    results = []
    try:
        try:
            snapshot = market.get_account_snapshot()
            positions = market.get_positions() if config["skip_held"] else {}
        except AlpacaMarketDataError as exc:
            logger.error("Scan skipped, account data unavailable: %s", exc)
            return _skipped(started, "data error: %s" % exc)

        universe, universe_source = resolve_universe(config, market, refresh=True)
        config["universe"] = universe
        logger.info(
            "Universe resolved: %s symbols from %s", len(universe), universe_source
        )

        batch = next_scan_batch(universe, config["batch_size"])
        watchlist = batch["tickers"]
        logger.info(
            "Scanning batch %s/%s (%s of %s symbols)",
            batch["index"],
            batch["count"],
            len(watchlist),
            batch["universe_size"],
        )
        for index, symbol in enumerate(watchlist):
            if risk_engine.is_kill_switch_active():
                logger.warning("Kill switch engaged mid-scan; aborting.")
                results.append({"ticker": symbol, "status": "ABORTED_KILL_SWITCH"})
                break

            position = positions.get(symbol)
            if config["skip_held"] and position and position["qty"] != 0:
                results.append({"ticker": symbol, "status": "SKIPPED_HELD"})
                logger.info("%s skipped: position already held", symbol)
                continue

            dedupe_ttl = max(60, config["interval_minutes"] * 60)
            if not claim_ticker_run(symbol, dedupe_ttl):
                results.append({"ticker": symbol, "status": "SKIPPED_DUPLICATE"})
                logger.info("%s skipped: already evaluated this interval", symbol)
                continue

            try:
                bars = market.get_bars(symbol)
                if len(bars) < 40:
                    results.append(
                        {
                            "ticker": symbol,
                            "status": "SKIPPED_NO_DATA",
                            "detail": "%s bars" % len(bars),
                        }
                    )
                    logger.warning("%s skipped: only %s bars", symbol, len(bars))
                    continue

                news = market.get_news_summary(symbol)
                payload = MarketInputPayload(
                    ticker=symbol,
                    historical_data=bars,
                    news_summary=news["summary"],
                    current_equity=snapshot["equity"],
                    current_daily_pnl=snapshot["daily_pnl_pct"],
                )

                db = SessionLocal()
                try:
                    result = run_pipeline(payload, db, dry_run=config["dry_run"])
                finally:
                    db.close()

                signal_payload = result.get("trade_signal") or {}
                results.append(
                    {
                        "ticker": symbol,
                        "status": result.get("status"),
                        "action": signal_payload.get("direction"),
                        "trade_id": result.get("trade_id"),
                    }
                )
                logger.info("%s -> %s", symbol, result.get("status"))
            except KillSwitchActive:
                logger.warning("Kill switch engaged on %s; aborting scan.", symbol)
                results.append({"ticker": symbol, "status": "ABORTED_KILL_SWITCH"})
                break
            except AlpacaMarketDataError as exc:
                logger.error("%s data error: %s", symbol, exc)
                results.append(
                    {"ticker": symbol, "status": "ERROR", "detail": str(exc)}
                )
            except Exception as exc:
                logger.exception("%s failed", symbol)
                results.append(
                    {"ticker": symbol, "status": "ERROR", "detail": str(exc)}
                )

            if index < len(watchlist) - 1 and config["ticker_delay_seconds"] > 0:
                time.sleep(config["ticker_delay_seconds"])
    finally:
        release_scan_lock()

    summary = {
        "started_at": started,
        "finished_at": _iso_now(),
        "dry_run": config["dry_run"],
        "watchlist": watchlist,
        "batch_index": batch["index"],
        "batch_count": batch["count"],
        "universe_size": batch["universe_size"],
        "results": results,
    }
    write_last_scan(summary)
    logger.info(
        "Scan complete: %s",
        ", ".join("%s=%s" % (r["ticker"], r["status"]) for r in results)
        or "no tickers evaluated",
    )
    return summary


def _sync_interval(scheduler: BlockingScheduler) -> None:
    """Applies a dashboard interval change without restarting the worker."""
    interval_minutes = load_scan_config()["interval_minutes"]
    job = scheduler.get_job("scan")
    if job is None:
        return

    current = None
    interval = getattr(job.trigger, "interval", None)
    if interval is not None:
        current = int(round(interval.total_seconds() / 60))

    if current != interval_minutes:
        scheduler.reschedule_job(
            "scan",
            trigger=IntervalTrigger(minutes=interval_minutes, timezone=TIMEZONE),
        )
        logger.info("Scanner interval updated to %s min.", interval_minutes)


def _heartbeat_job(scheduler: BlockingScheduler) -> None:
    try:
        _sync_interval(scheduler)
    except Exception:
        logger.exception("Could not sync scanner interval")

    extra: Dict[str, Any] = {}
    job = scheduler.get_job("scan")
    if job is not None and job.next_run_time is not None:
        next_run_at = job.next_run_time.isoformat()
        extra["next_run_at"] = next_run_at
        write_next_run(next_run_at)
    write_heartbeat(extra)


def _scan_job() -> None:
    try:
        run_scan()
    except Exception:
        logger.exception("Scheduled scan crashed")


def main() -> None:
    config = load_scan_config()

    try:
        market = AlpacaMarketData()
    except AlpacaMarketDataError as exc:
        logger.error("Worker cannot start: %s", exc)
        raise SystemExit(1)

    if config["run_once"]:
        logger.info("Running one-shot scan.")
        run_scan(config, market)
        return

    first_run = (
        datetime.now(timezone.utc) if config["run_on_startup"] else None
    )
    scheduler = BlockingScheduler(timezone=TIMEZONE)
    scheduler.add_job(
        _scan_job,
        IntervalTrigger(minutes=config["interval_minutes"], timezone=TIMEZONE),
        id="scan",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
        next_run_time=first_run,
    )
    scheduler.add_job(
        lambda: _heartbeat_job(scheduler),
        IntervalTrigger(seconds=60, timezone=TIMEZONE),
        id="heartbeat",
        max_instances=1,
        coalesce=True,
    )

    write_heartbeat({"next_run_at": (
        scheduler.get_job("scan").next_run_time.isoformat()
        if scheduler.get_job("scan").next_run_time
        else None
    )})
    logger.info(
        "Scanner started: every %s min, mode=%s, universe=%s symbols, batch=%s, dry_run=%s",
        config["interval_minutes"],
        config["universe_mode"],
        len(config["universe"]),
        config["batch_size"],
        config["dry_run"],
    )

    def _shutdown(signum, frame) -> None:
        logger.info("Worker shutting down (signal %s).", signum)
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        pass


if __name__ == "__main__":
    main()
