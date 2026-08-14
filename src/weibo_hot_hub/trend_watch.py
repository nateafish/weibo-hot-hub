from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from .storage import save_topic_trends
from .topic import fetch_topic_trends
from .weibo import _sleep_with_jitter


# A topic counts as having heat only while one of its most recent trend
# points is at or above this value (per-bucket read increments). Below it the
# topic is considered off the map and stops being collected after
# RECENT_POINTS consecutive quiet buckets.
HEAT_THRESHOLD = 10_000
# How many of the most recent trend points are examined for the heat check.
RECENT_POINTS = 3
# Trend records older than this are never used to drop a topic; a stale
# record only means the topic could not be collected recently, not that it
# went cold.
MAX_RECORD_AGE = timedelta(hours=25)
# Hard cap on how many off-list topics a single run collects, oldest first.
MAX_OFFLIST_PER_RUN = 100


@dataclass(frozen=True)
class TrendWatchCandidate:
    topic_id: str
    title: str
    query: str
    last_listed_at: datetime
    cadence: str


def normalized_query(value: str) -> str:
    return value.strip().strip("#").strip().casefold()


def is_rate_limit_error(value: str) -> bool:
    lowered = value.casefold()
    return any(
        f"'{status} '" in lowered or f"http {status}" in lowered
        for status in (403, 418, 429, 432)
    )


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _parse_datetime(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else None


def latest_trend_record(topic_root: Path) -> dict[str, Any]:
    paths = sorted((topic_root / "trends").glob("*/*.jsonl"), reverse=True)
    for path in paths:
        try:
            lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line]
            if lines:
                value = json.loads(lines[-1])
                if isinstance(value, dict):
                    return value
        except (OSError, ValueError):
            continue
    return {}


def recent_heat_values(
    record: dict[str, Any],
    recent: int = RECENT_POINTS,
) -> list[float]:
    """Numeric values of the most recent trend points across all series."""
    values: list[float] = []
    for points in (record.get("24h") or {}).values():
        if not isinstance(points, list):
            continue
        for point in [p for p in points if isinstance(p, dict)][-recent:]:
            try:
                values.append(float(str(point.get("value") or 0).replace(",", "")))
            except ValueError:
                continue
    return values


def trend_has_heat(
    record: dict[str, Any],
    threshold: float = HEAT_THRESHOLD,
) -> bool:
    """A topic is active while any of its most recent trend points is at or
    above the threshold; the whole 24-hour window is no longer considered,
    so quiet topics stop being collected a few hours after they go cold."""
    return any(value >= threshold for value in recent_heat_values(record))


def select_offlist_topics(
    data_root: Path,
    captured_at: datetime,
    current_queries: set[str],
    max_topics: int = MAX_OFFLIST_PER_RUN,
) -> list[TrendWatchCandidate]:
    """Select due off-list topics: hourly for seven days, then once per day,
    capped per run and ordered by oldest capture first."""
    selected: list[tuple[datetime, TrendWatchCandidate]] = []
    current = {normalized_query(query) for query in current_queries}
    for meta_path in (data_root / "topics").glob("*/meta.json"):
        meta = _read_json(meta_path)
        topic_id = str(meta.get("topic_id") or meta_path.parent.name)
        title = str(meta.get("title") or "").strip()
        query = str(meta.get("query") or (f"#{title}#" if title else ""))
        last_listed_at = _parse_datetime(meta.get("last_seen_at"))
        if not topic_id or not query or not last_listed_at:
            continue
        if normalized_query(query) in current:
            continue

        latest = latest_trend_record(meta_path.parent)
        if not latest:
            continue
        last_capture = _parse_datetime(latest.get("captured_at")) or _parse_datetime(
            latest.get("capture_hour")
        )
        if not last_capture:
            continue

        # A stale record only means collection has been failing; never drop a
        # topic on stale data. The heat decision is re-made on fresh data
        # inside collect_offlist_trends.
        if captured_at - last_capture.astimezone(captured_at.tzinfo) <= MAX_RECORD_AGE:
            if not trend_has_heat(latest):
                continue

        age = captured_at - last_listed_at.astimezone(captured_at.tzinfo)
        if age <= timedelta(days=7):
            due = last_capture < captured_at
            cadence = "hourly"
        else:
            due = last_capture.astimezone(captured_at.tzinfo).date() < captured_at.date()
            cadence = "daily"
        if due:
            candidate = TrendWatchCandidate(topic_id, title, query, last_listed_at, cadence)
            selected.append((last_capture, candidate))

    ordered = sorted(selected, key=lambda item: item[0])
    return [candidate for _, candidate in ordered[:max_topics]]


def collect_offlist_trends(
    http: httpx.Client,
    data_root: Path,
    captured_at: datetime,
    current_queries: set[str],
    max_topics: int = MAX_OFFLIST_PER_RUN,
) -> list[dict[str, Any]]:
    candidates = select_offlist_topics(
        data_root, captured_at, current_queries, max_topics=max_topics
    )
    results: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates):
        item: dict[str, Any] = {
            "topic_id": candidate.topic_id,
            "title": candidate.title,
            "query": candidate.query,
            "cadence": candidate.cadence,
            "last_listed_at": candidate.last_listed_at.isoformat(),
            "metrics": "pending",
        }
        try:
            trends = fetch_topic_trends(
                http,
                candidate.query,
                candidate.topic_id,
                captured_at,
            )
            save_topic_trends(data_root, candidate.topic_id, trends, captured_at)
            item["metrics"] = "saved"
            item["has_heat"] = trend_has_heat(trends)
        except Exception as exc:
            item["metrics"] = "failed"
            item["metrics_error"] = f"{type(exc).__name__}: {exc}"[:500]
        results.append(item)
        if is_rate_limit_error(str(item.get("metrics_error") or "")):
            item["circuit_breaker"] = "rate_limit"
            break
        if index + 1 < len(candidates):
            _sleep_with_jitter(1.5, 0.5)
    return results
