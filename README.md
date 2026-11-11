# Aegis-Quant

An autonomous, risk-guarded paper-trading desk. Aegis-Quant combines a temporal anonymization firewall, HMM regime detection, an adversarial LLM debate, deterministic position sizing, and Alpaca paper execution behind a Next.js operations dashboard.

> Research prototype. It trades only against Alpaca's paper API. Nothing here is financial advice.

## Highlights

- **Five-stage decision pipeline** with the LLM kept away from position sizing.
- **Adversarial debate** using LangGraph: a Bull agent, a Bear agent, and a Judge agent.
- **Deterministic guardrails**: hard daily-loss circuit breaker, fractional Kelly sizing, 2x ATR stops.
- **Live scanner**: static watchlist or Alpaca most-active universe, batched rotation, configurable from the dashboard.
- **Full audit trail**: every HOLD, dry run, rejection, and execution is journaled in Postgres.
- **Operations UI**: pipeline progress, regime/backtest view, journal analytics, CSV export, kill switch, worker health, scanner controls.

## Architecture

```text
                    +---------------------------+
                    |  Next.js dashboard :3001  |
                    +-------------+-------------+
                                  |
                                  v
                    +---------------------------+
                    |  FastAPI API :8000        |
                    |  manual + analyze + admin |
                    +------+-------------+------+
                           |             |
              +------------+             +-------------+
              |                                        |
              v                                        v
   +---------------------+                  +----------------------+
   | Worker (APScheduler)|                  | Redis                |
   | periodic scan sweep |<---------------->| kill switch          |
   +----------+----------+                  | scanner config/state |
              |                             +----------------------+
              v
   +---------------------+                  +----------------------+
   | Decision pipeline   |----------------->| Postgres journal     |
   | firewall -> regime  |                  +----------------------+
   | -> debate -> risk   |
   | -> paper execution  |
   +----------+----------+
              |
              v
   Alpaca data/account/orders + Groq LLM
```

### Decision pipeline

`backend/core/pipeline.py` runs one evaluation end to end:

1. **Temporal firewall** (`firewall.py`) anonymizes the ticker and normalizes prices before any model sees the data.
2. **Regime router** (`router.py`) fits an HMM to daily bars, classifies the current regime, and produces a VectorBT validation report.
3. **Adversarial debate** (`agents.py`) asks Bull and Bear agents to argue the setup, then a Judge emits `BUY`, `SELL`, or `HOLD` with conviction, reasoning, catalysts, and risks.
4. **Deterministic risk engine** (`risk_engine.py`) checks the Redis kill switch and the daily drawdown cap, then sizes the trade with quarter Kelly, capped at 2% of equity, with a 2x ATR stop. Negative-edge setups are rejected.
5. **Execution and audit** (`broker.py`, `pipeline.py`) submits an Alpaca paper market order (or a mock fill when broker keys are absent) and writes the outcome to the `trade_journals` table.

The scanner reuses the same pipeline, so scheduled and manual evaluations behave identically.

## Quick start

Prerequisites: Docker Desktop with Compose v2, a Groq API key, and Alpaca paper credentials.

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set at minimum:

```dotenv
GROQ_API_KEY=...
ALPACA_API_KEY=...
ALPACA_SECRET_KEY=...
```

`DATABASE_URL` is required. For the bundled Postgres container, use the service hostname rather than `localhost`:

```dotenv
DATABASE_URL=postgresql://aegis_user:aegis_password@postgres:5432/aegis_quant_db
```

If you use Supabase, use the pooler connection string. Direct `db.<project-ref>.supabase.co` hosts are IPv6-only and are commonly unreachable from Docker.

Build and start everything:

```powershell
docker compose up -d --build
docker compose ps
```

| Service | URL |
| --- | --- |
| Dashboard | http://localhost:3001 |
| API | http://localhost:8000 |
| Interactive API docs | http://localhost:8000/docs |

The first build compiles TA-Lib and installs the dashboard dependencies, so it can take several minutes. The dashboard is mapped to host port 3001 because 3000 is frequently already in use.

## Configuration

### Core environment variables

These are read from `.env` by `docker-compose.yml`:

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq key for the Bull/Bear/Judge agents | Required for live evaluations |
| `ALPACA_API_KEY` | Alpaca paper API key | Required for market data and execution |
| `ALPACA_SECRET_KEY` | Alpaca paper secret | Required for market data and execution |
| `ALPACA_BASE_URL` | Alpaca trading endpoint | Compose fixes this to `https://paper-api.alpaca.markets` |
| `DATABASE_URL` | SQLAlchemy Postgres URL | Required; see the Docker hostname note above |
| `REDIS_URL` | Redis URL | Compose overrides it to `redis://redis:6379/0` |
| `AEGIS_WATCHLIST` | Static watchlist, comma-separated | Blank uses the curated 50-symbol universe in `backend/core/universe.py` |
| `AEGIS_SCAN_BATCH_SIZE` | Symbols evaluated per sweep | `10` |
| `AEGIS_SCAN_INTERVAL_MINUTES` | Sweep interval | `60` |
| `AEGIS_SCAN_DRY_RUN` | Journal signals without submitting orders | `false` |
| `AEGIS_SCAN_SKIP_HELD` | Skip symbols already held in the Alpaca account | `true` |
| `AEGIS_SCAN_MARKET_HOURS_ONLY` | Skip sweeps while the market is closed | `true` |
| `AEGIS_SCAN_ENABLED` | Enable scheduled scanning | `true` |
| `AEGIS_SCAN_TICKER_DELAY_SECONDS` | Delay between tickers in a sweep | `2` |
| `NEXT_PUBLIC_API_BASE_URL` | API URL baked into the dashboard at build time | `http://localhost:8000` |

Changing `NEXT_PUBLIC_API_BASE_URL` requires rebuilding the dashboard image. Changing backend environment variables requires recreating the `backend` and `worker` containers.

Additional scanner defaults live in `backend/core/scan_config.py` (`AEGIS_SCAN_UNIVERSE_MODE`, `AEGIS_SCAN_UNIVERSE_SIZE`, `AEGIS_SCAN_UNIVERSE_MIN_PRICE`, `AEGIS_SCAN_RUN_ON_STARTUP`). Compose does not forward these by default; configure them from the dashboard or add them to both backend service environments.

Test-only worker overrides can be passed directly:

```powershell
docker compose run --rm -e AEGIS_SCAN_RUN_ONCE=true -e AEGIS_SCAN_FORCE=true worker
```

- `AEGIS_SCAN_RUN_ONCE` runs one sweep and exits.
- `AEGIS_SCAN_FORCE` bypasses the market-hours check.

Other code-level settings: `ALPACA_DATA_FEED` defaults to `iex` (`iex`, `sip`, or `otc`) and `ALPACA_DATA_CACHE_TTL` defaults to `60` seconds.

### Live scanner settings

The dashboard's scanner panel writes overrides to Redis and the worker applies them without a restart. Precedence is:

```text
Redis dashboard overrides > environment variables > built-in defaults
```

| Setting | Values |
| --- | --- |
| Universe mode | `static` or `most_active` |
| Static universe | Up to 100 symbols, comma/space/newline separated |
| Most-active size | 1 to 100 symbols |
| Minimum price | 0 to 10000 |
| Batch size | 1 to 100 |
| Interval | 1 to 1440 minutes |
| Toggles | dry run, skip held, market hours only |

The most-active universe comes from Alpaca's screener, excludes common leveraged/inverse products, and filters by the configured minimum price. Status and config reads reuse a 15-minute Redis cache; the worker requests a fresh screener snapshot on every sweep. Static mode uses the dashboard universe if set, otherwise `AEGIS_WATCHLIST`, otherwise the curated 50-symbol list.

The worker checks for interval changes on its 60-second heartbeat, so a new interval is adopted within about a minute. Universe-affecting changes also reset the batch rotation cursor.

To clear all dashboard overrides and return to environment defaults:

```powershell
curl.exe -X DELETE http://localhost:8000/api/v1/scan/config
```

## API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/evaluate-trade` | Run the pipeline from a caller-supplied market snapshot |
| `POST` | `/api/v1/analyze/{ticker}?dry_run=true` | Pull bars, news, and account equity from Alpaca and evaluate a ticker |
| `GET` | `/api/v1/journals?limit=50` | Recent trade journal entries (alias: `/api/v1/trades`) |
| `GET` | `/api/v1/scan/status` | Scanner config, current batch, worker heartbeat, last/next run |
| `GET` | `/api/v1/scan/config` | Editable scanner config plus the resolved universe |
| `PUT` | `/api/v1/scan/config` | Save partial scanner overrides to Redis |
| `DELETE` | `/api/v1/scan/config` | Reset overrides and universe cache |
| `POST` | `/api/v1/scan/universe/refresh` | Force a fresh most-active universe resolution |
| `POST` | `/api/v1/scan/pause` | Pause scheduled scans |
| `POST` | `/api/v1/scan/resume` | Resume scheduled scans |
| `GET` | `/api/v1/kill-switch/status` | Read circuit-breaker state |
| `POST` | `/api/v1/kill-switch/trigger?reason=...` | Manually engage the circuit breaker |

### Analyze a ticker

`analyze` defaults to a dry run and requires at least 40 daily bars. It fetches 180 days of bars, the last 48 hours of news, and the paper-account equity/PnL.

```powershell
curl.exe -X POST "http://localhost:8000/api/v1/analyze/NVDA?dry_run=true"
```

Pass `dry_run=false` to submit a paper order when the debate and risk engine approve the setup.

### Evaluate a supplied snapshot

`historical_data` must be ascending daily OHLCV bars. Pass 40 or more bars for reliable regime detection. `current_daily_pnl` is a fraction, not a percentage: `-0.025` means -2.5%.

```json
{
  "ticker": "NVDA",
  "historical_data": [
    {
      "timestamp": "2026-01-02T05:00:00+00:00",
      "open": 185.0,
      "high": 189.5,
      "low": 184.2,
      "close": 188.8,
      "volume": 45000000
    }
  ],
  "news_summary": "Headline and summary text for the model.",
  "current_equity": 100000,
  "current_daily_pnl": -0.004
}
```

```powershell
curl.exe -X POST http://localhost:8000/api/v1/evaluate-trade `
  -H "Content-Type: application/json" `
  --data-binary "@payload.json"
```

Responses use `status` values such as `HOLD`, `DRY_RUN`, `REJECTED_BY_RISK_ENGINE`, and `SUCCESS`, and include the regime, VectorBT report, trade signal, risk allocation, broker result, and journal `trade_id`.

### Update scanner settings

`PUT /api/v1/scan/config` accepts any subset of fields:

```json
{
  "universe_mode": "most_active",
  "universe_size": 25,
  "universe_min_price": 20,
  "batch_size": 10,
  "interval_minutes": 30,
  "dry_run": true,
  "skip_held": true,
  "market_hours_only": true
}
```

Invalid modes, empty/oversized universes, and out-of-range numeric values return `422`.

## Kill switch

The circuit breaker is a Redis flag. It blocks `analyze`, blocks the pipeline, and causes scheduled scans to skip.

It engages automatically when daily P&L reaches `-2.5%`, or manually:

```powershell
curl.exe -X POST "http://localhost:8000/api/v1/kill-switch/trigger?reason=Manual%20halt"
```

Check state:

```powershell
curl.exe http://localhost:8000/api/v1/kill-switch/status
```

Reset it deliberately after reviewing the account:

```powershell
docker exec aegis-redis redis-cli DEL AEGIS_KILL_SWITCH_ENGAGED AEGIS_KILL_REASON
```

The kill switch halts new evaluations. It does not liquidate positions or cancel existing orders. Stop-loss prices are calculated and journaled, but currently they are not submitted to Alpaca as resting stop orders.

Pausing the scanner is separate from the kill switch: pausing only stops scheduled sweeps, while the kill switch blocks every trading path.

## Project layout

```text
.
├── backend/
│   ├── main.py                 FastAPI routes and app startup
│   ├── worker.py               APScheduler scanner worker
│   ├── core/
│   │   ├── pipeline.py         Five-stage decision pipeline
│   │   ├── firewall.py         Ticker anonymization and price normalization
│   │   ├── router.py           HMM regime detection and VectorBT validation
│   │   ├── agents.py           LangGraph Bull/Bear/Judge debate
│   │   ├── risk_engine.py      Kelly sizing, ATR stops, kill switch
│   │   ├── broker.py           Alpaca paper execution and mock fallback
│   │   ├── market_data.py      Bars, news, account, clock, screener
│   │   ├── scan_config.py      Environment + Redis config merge
│   │   ├── scan_state.py       Redis heartbeat/lock/batch/config state
│   │   ├── universe.py         Static and most-active universe resolution
│   │   └── ...
│   ├── database/
│   │   ├── models.py           TradeJournalModel
│   │   └── session.py          SQLAlchemy engine/session
│   ├── Dockerfile
│   └── requirements.txt
├── dashboard/
│   ├── app/                    Next.js App Router pages and styles
│   ├── components/             Operations UI and scanner controls
│   ├── lib/                    Typed API client and CSV export
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
└── .env.example
```

## Operations

View logs:

```powershell
docker logs -f aegis-backend
docker logs -f aegis-worker
docker logs -f aegis-dashboard
```

Rebuild after changing backend code (the containers have no bind mount):

```powershell
docker compose up -d --build backend worker dashboard
```

Check scanner health:

```powershell
curl.exe http://localhost:8000/api/v1/scan/status
```

`worker_alive` is true when the worker heartbeat is under 180 seconds old. Redis holds ephemeral state only (scanner config, cache, rotation cursor, heartbeat, and kill switch); recreating the Redis container clears all of it. The Postgres journal persists in the `pgdata` volume.

Run the dashboard locally for faster UI iteration:

```powershell
Set-Location dashboard
npm install
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:8000"
npm run dev
```

The backend CORS policy allows any `http://localhost:<port>` or `http://127.0.0.1:<port>` origin. There is no automated test suite; use the API docs, scanner status, worker logs, and a dry-run analysis to verify changes.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Dashboard unreachable on port 3000 | It is mapped to 3001. Open http://localhost:3001. |
| Backend cannot connect to Postgres | For Compose, use hostname `postgres`, not `localhost`. For Supabase, use the pooler URL. |
| Worker shows offline in the dashboard | Check `docker logs aegis-worker`; the heartbeat must be under 180 seconds old. |
| Analysis returns 503 | Alpaca keys are missing or invalid, so the market-data client cannot initialize. |
| Analysis returns 422 about bars | Fewer than 40 daily bars are available for that symbol. |
| Scans never run | Check `AEGIS_SCAN_ENABLED`, scanner pause state, market hours, kill switch, and worker logs. |
| Kill switch will not clear in the UI | It is reset by design only via Redis, not from the dashboard. Use the `redis-cli DEL` command above. |
| Dashboard calls the wrong API URL | `NEXT_PUBLIC_API_BASE_URL` is a build arg. Rebuild the dashboard image after changing it. |
| Code changes are not reflected | Rebuild the affected container; backend and worker have no bind mounts. |

## Security and limitations

- This is a paper-trading prototype. Execution clients are instantiated in Alpaca paper mode.
- The API has no authentication, rate limiting, or tenant isolation. Do not expose ports 8000, 5432, or 6379 publicly.
- `.env` is ignored by Git. Do not commit real keys; rotate any credential that has been shared or logged.
- Agent output can be wrong. Deterministic guardrails limit size and daily loss, but they do not guarantee profitability.
- The scanner is a single worker process with Redis-based locking. It is not a horizontally scaled job system.
- Stops are advisory/journal-only at present; there is no automated exit engine or resting stop order.
- The dashboard currently uses Next.js 14. `npm audit` reports advisories that require a breaking major upgrade.
