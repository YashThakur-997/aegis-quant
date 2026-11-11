import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import requests
from alpaca.data.enums import DataFeed
from alpaca.data.historical.news import NewsClient
from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.data.requests import NewsRequest, StockBarsRequest
from alpaca.data.timeframe import TimeFrame
from alpaca.trading.client import TradingClient

logger = logging.getLogger(__name__)

# Leveraged/inverse products distort the HMM regime and Kelly sizing, so the
# dynamic universe excludes the most common ones even when they top the tape.
_EXCLUDED_LEVERAGED = {
    "BULZ",
    "BOIL",
    "BRZU",
    "DFEN",
    "DUST",
    "ERX",
    "ERY",
    "FAS",
    "FAZ",
    "FNGD",
    "FNGU",
    "JDST",
    "JNUG",
    "KOLD",
    "LABD",
    "LABU",
    "NAIL",
    "NUGT",
    "SOXL",
    "SOXS",
    "SPXL",
    "SPXS",
    "SPXU",
    "SQQQ",
    "SVXY",
    "TECS",
    "TECL",
    "TQQQ",
    "TPOR",
    "TNA",
    "TZA",
    "UPRO",
    "UVXY",
    "VIXY",
    "VXX",
    "WEBS",
    "WEBL",
    "YANG",
    "YINN",
}


class AlpacaMarketDataError(RuntimeError):
    """Raised when Alpaca cannot supply the data required for an evaluation."""


class AlpacaMarketData:
    """Read-only Alpaca client for bars, news, and paper-account equity."""

    def __init__(self) -> None:
        self.api_key = os.getenv("ALPACA_API_KEY")
        self.secret_key = os.getenv("ALPACA_SECRET_KEY")
        self.feed_name = os.getenv("ALPACA_DATA_FEED", "iex").strip().lower()
        self.cache_ttl = float(os.getenv("ALPACA_DATA_CACHE_TTL", "60"))
        self._cache: Dict[str, tuple] = {}

        if not self.api_key or not self.secret_key:
            raise AlpacaMarketDataError(
                "ALPACA_API_KEY and ALPACA_SECRET_KEY must be set."
            )

        self.trading = TradingClient(self.api_key, self.secret_key, paper=True)
        self.stocks = StockHistoricalDataClient(self.api_key, self.secret_key)
        self.news = NewsClient(self.api_key, self.secret_key)

    def _feed(self) -> DataFeed:
        return {
            "iex": DataFeed.IEX,
            "sip": DataFeed.SIP,
            "otc": DataFeed.OTC,
        }.get(self.feed_name, DataFeed.IEX)

    def _cached(self, key: str, producer):
        now = time.time()
        cached = self._cache.get(key)
        if cached and now - cached[0] < self.cache_ttl:
            return cached[1]
        value = producer()
        self._cache[key] = (now, value)
        return value

    def get_account_snapshot(self) -> Dict[str, float]:
        """Returns paper-account equity and today's PnL as a fraction (e.g. -0.0125)."""

        def fetch():
            try:
                account = self.trading.get_account()
            except Exception as exc:
                raise AlpacaMarketDataError(
                    f"Could not read Alpaca account: {exc}"
                ) from exc

            equity = float(account.equity)
            last_equity = float(account.last_equity or equity)
            daily_pnl_pct = (
                0.0 if last_equity <= 0 else (equity - last_equity) / last_equity
            )
            return {
                "equity": equity,
                "last_equity": last_equity,
                "daily_pnl_pct": daily_pnl_pct,
            }

        return self._cached("account", fetch)

    def is_market_open(self) -> bool:
        """Returns whether the US equity market is currently open."""

        def fetch():
            try:
                clock = self.trading.get_clock()
            except Exception as exc:
                raise AlpacaMarketDataError(
                    f"Could not read Alpaca clock: {exc}"
                ) from exc
            return bool(clock.is_open)

        return self._cached("clock", fetch)

    def get_positions(self) -> Dict[str, Dict[str, Any]]:
        """Returns open paper positions keyed by ticker."""

        def fetch():
            try:
                positions = self.trading.get_all_positions()
            except Exception as exc:
                raise AlpacaMarketDataError(
                    f"Could not read Alpaca positions: {exc}"
                ) from exc

            result: Dict[str, Dict[str, Any]] = {}
            for position in positions:
                try:
                    qty = float(position.qty)
                except (TypeError, ValueError):
                    qty = 0.0
                result[position.symbol.upper()] = {
                    "qty": qty,
                    "side": str(position.side),
                    "market_value": float(position.market_value or 0.0),
                }
            return result

        return self._cached("positions", fetch)

    def get_most_active_symbols(
        self,
        top: int = 30,
        min_price: float = 10.0,
        by: str = "trades",
    ) -> List[str]:
        """Returns liquid, non-leveraged symbols from Alpaca's most-active screener.

        Falls back to the unfiltered screener order if snapshots are unavailable,
        so a sweep can still run on a degraded feed.
        """
        limit = max(1, min(100, int(top)))
        request_top = min(100, max(40, limit * 2))
        headers = {
            "APCA-API-KEY-ID": self.api_key or "",
            "APCA-API-SECRET-KEY": self.secret_key or "",
        }

        try:
            response = requests.get(
                "https://data.alpaca.markets/v1beta1/screener/stocks/most-actives",
                params={"top": request_top, "by": by},
                headers=headers,
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise AlpacaMarketDataError(
                "Could not fetch most-active symbols: %s" % exc
            ) from exc

        symbols: List[str] = []
        for item in payload.get("most_actives") or []:
            symbol = str(item.get("symbol") or "").strip().upper()
            if not symbol or symbol in _EXCLUDED_LEVERAGED:
                continue
            if "/" in symbol or ":" in symbol or symbol in symbols:
                continue
            symbols.append(symbol)

        if not symbols:
            return []

        try:
            snapshot_response = requests.get(
                "https://data.alpaca.markets/v2/stocks/snapshots",
                params={"symbols": ",".join(symbols), "feed": self.feed_name},
                headers=headers,
                timeout=15,
            )
            snapshot_response.raise_for_status()
            payload = snapshot_response.json()
            if isinstance(payload, dict):
                snapshots = payload.get("snapshots") or {
                    symbol: data
                    for symbol, data in payload.items()
                    if symbol != "next_page_token"
                }
            else:
                snapshots = {}
        except (requests.RequestException, ValueError) as exc:
            logger.warning(
                "Snapshot price filter unavailable, using raw most-active list: %s",
                exc,
            )
            return symbols[:limit]

        filtered: List[str] = []
        for symbol in symbols:
            snapshot = snapshots.get(symbol) or {}
            price = (snapshot.get("latestTrade") or {}).get("p")
            if price is None:
                price = (snapshot.get("dailyBar") or {}).get("c")
            if price is None:
                price = (snapshot.get("prevDailyBar") or {}).get("c")
            try:
                if float(price) < min_price:
                    continue
            except (TypeError, ValueError):
                continue
            filtered.append(symbol)
            if len(filtered) >= limit:
                break

        return filtered or symbols[:limit]

    def get_bars(self, ticker: str, days: int = 180) -> List[Dict[str, Any]]:
        """Returns ascending daily OHLCV bars from Alpaca's configured feed."""

        symbol = ticker.strip().upper()

        def fetch():
            request = StockBarsRequest(
                symbol_or_symbols=symbol,
                timeframe=TimeFrame.Day,
                start=datetime.now(timezone.utc) - timedelta(days=days),
                feed=self._feed(),
            )
            try:
                response = self.stocks.get_stock_bars(request)
            except Exception as exc:
                raise AlpacaMarketDataError(
                    f"Could not fetch bars for {symbol}: {exc}"
                ) from exc

            bars = (response.data or {}).get(symbol, [])
            return [
                {
                    "timestamp": bar.timestamp.isoformat(),
                    "open": float(bar.open),
                    "high": float(bar.high),
                    "low": float(bar.low),
                    "close": float(bar.close),
                    "volume": float(bar.volume),
                }
                for bar in bars
            ]

        return self._cached(f"bars:{symbol}:{days}", fetch)

    def get_news_summary(
        self, ticker: str, hours: int = 48, limit: int = 10
    ) -> Dict[str, Any]:
        """Returns a plain-text news digest plus the article count."""

        symbol = ticker.strip().upper()

        def fetch():
            request = NewsRequest(
                symbols=symbol,
                start=datetime.now(timezone.utc) - timedelta(hours=hours),
                limit=limit,
            )
            try:
                response = self.news.get_news(request)
            except Exception as exc:
                logger.warning("News unavailable for %s: %s", symbol, exc)
                return {
                    "summary": "No recent news available.",
                    "count": 0,
                    "headlines": [],
                }

            data = response.data or {}
            items = [item for group in data.values() for item in group]
            items.sort(
                key=lambda item: getattr(
                    item, "created_at", datetime.min.replace(tzinfo=timezone.utc)
                ),
                reverse=True,
            )

            lines: List[str] = []
            headlines: List[str] = []
            for item in items:
                headline = (getattr(item, "headline", "") or "").strip()
                summary = (getattr(item, "summary", "") or "").strip()
                source = (getattr(item, "source", "") or "").strip()
                if not headline and not summary:
                    continue
                line = f"- {headline}" if headline else "-"
                if summary:
                    line += f". {summary}"
                if source:
                    line += f" ({source})"
                lines.append(line)
                if headline:
                    headlines.append(headline)

            return {
                "summary": "\n".join(lines) if lines else "No recent news available.",
                "count": len(lines),
                "headlines": headlines[:5],
            }

        return self._cached(f"news:{symbol}:{hours}:{limit}", fetch)
