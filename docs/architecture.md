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
3. Save overview, host, category, rank history, contributors, and 1-hour/24-hour trends.
4. Fetch the first mobile keyword-search page in the hourly job; manual runs may request 1–10 pages. Fetch a detail page only when `isLongText` is true.
5. Store each post body once by `mid`; store hourly page order separately.
6. Fetch the AI answer; discard refusal responses and save Markdown only when normalized content changes.
7. Save a run report and commit all changes once.

All topic work is sequential to avoid concurrent requests from the same account. The workflow uses a global data-writer concurrency group so scheduled and manual archive jobs cannot push simultaneously.

## Data layout

```text
data/
  hotlists/YYYY/MM/DD/HH.json
  runs/YYYY/MM/DD/HH.json
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
