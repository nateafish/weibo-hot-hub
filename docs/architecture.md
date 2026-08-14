# Architecture

This document contains implementation details that intentionally stay out of the project README.

## Reference boundaries

- The hotlist entry point and hourly archive behavior follow the proven approach used by `justjavac/weibo-trending-hot-search` and `nateafish/trending-in-one`.
- Login checks, mobile keyword search, nested card filtering, low request concurrency, and long-text fallback follow the protocol flow demonstrated by MediaCrawler.
- Shallow checkout, workflow timeouts, and single-run concurrency follow the operational patterns used by TrendRadar.
- Topic metrics, trend retention, AI-search normalization, content-addressed post objects, and hourly indexes are implemented specifically for this project because the references do not provide them.

MediaCrawler is distributed under its own non-commercial learning license. This repository does not copy its modules; it independently implements the observed request and control flow.

## Secrets

- `WEIBO_COOKIE`: PC Weibo session used for the hotlist and AI search.
- `WEIBO_MOBILE_COOKIE`: mobile Weibo session used for `/api/config`, keyword search, and long post detail pages.

Neither value is written to files, artifacts, logs, commits, or the README. Cookie health is stored at `data/state/cookies.json` with status and reason only.

## Hourly flow

The hourly workflow runs as one sequential data writer:

1. Fetch the full hotlist.
2. Resolve each title to a stable topic ID through the public topic detail endpoint.
3. Save overview, host, category, rank history, contributors, and 24-hour trends. (The 6m/1h trend endpoint is intentionally not used; it overlaps the 24-hour window and cost one extra request per topic.)
4. Fetch the first mobile keyword-search page in the hourly job; manual runs may request 1–10 pages. Fetch a detail page only when `isLongText` is true.
5. Store each post body once by `mid`; store hourly page order separately.
6. Fetch the AI answer; discard refusal responses and save Markdown only when normalized content changes.
7. Save a run report and commit all changes once.

Validation is informational, not blocking: success-rate thresholds are written to `runs/…/HH.json` under `validation` with `status: ok|degraded`, and the run still commits whatever was captured (at minimum the raw hotlist). A run only hard-fails when the hotlist itself or the login check fails. The watchdog therefore stops re-dispatching a degraded hour once its run record is committed.

All topic work is sequential to avoid concurrent requests from the same account. The workflow uses a global data-writer concurrency group so scheduled and manual archive jobs cannot push simultaneously.

## Off-list trend watch

Off-list (off-the-hotlist) topic trends are collected by a separate scheduled workflow (`trend-watch.yml`, every six hours at 01:47/07:47/13:47/19:47 UTC) instead of the hourly archive, so metric anomalies on the main list can never stall the core hour again. Off-list heat changes slowly, so the six-hour cadence keeps the archive fresh at roughly a sixth of the old request load. Each run is capped (`MAX_OFFLIST_PER_RUN = 150`) and picks the oldest-captured topics first; a 418/429/432 response opens the circuit breaker and stops the run immediately.

Captures are stored as deltas: the 24-hour endpoint returns the whole sliding window, so each run appends only the points newer than the topic's previous capture instead of re-storing the overlapping hours. The site export rebuilds the full window per capture, so the archived curves keep hourly resolution while each record stays small.

A topic counts as having heat only while one of its most recent three trend points is at or above `HEAT_THRESHOLD = 10_000` (per-bucket read increments; the lowest currently-listed topic sits around 24K, so 10K keeps a margin while pruning topics that have gone quiet). Trend records older than 25 hours are never used to drop a topic — a stale record only means collection has been failing.

## Run records

`runs/…/HH.json` carries `status: ok | degraded | failed`. A failed record is written when a whole hour could not be captured (e.g. an account-level rate limit); it exists so the archive documents the gap instead of silently missing it, and so the watchdog treats the hour as handled.

## Data layout

```text
data/
  hotlists/YYYY/MM/DD/HH.json
  runs/YYYY/MM/DD/HH.json
  trend-watch-runs/YYYY/MM/DD/HH.json
  state/cookies.json
  topics/<stable-topic-id>/
    meta.json
    snapshots/YYYY/MM/DD/HH.json
    trends/YYYY/MM-DD.jsonl
    posts/objects/<mid>.json
    post-index/YYYY/MM/DD/HH.json
    ai/state.json
    ai/YYYY/MM/DD/HHMMSS-<hash8>.md
```

Repeated execution within the same hour replaces the hour snapshot and the matching JSONL record. Existing post objects are not rewritten. AI Markdown is created only when the normalized SHA-256 changes.
