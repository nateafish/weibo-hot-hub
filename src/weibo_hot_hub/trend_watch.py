from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class TrendWatchCandidate:
    topic_id: str
    title: str
    query: str
    last_listed_at: datetime
    cadence: str


def normalized_query(value: str) -> str:
    return value.strip().strip("#").strip().casefold()


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


def trend_has_heat(record: dict[str, Any]) -> bool:
    """A topic is active while any bucket in its complete 24-hour window is non-zero."""
    for points in (record.get("24h") or {}).values():
        for point in points if isinstance(points, list) else []:
            if not isinstance(point, dict):
                continue
            try:
                if float(str(point.get("value") or 0).replace(",", "")) > 0:
                    return True
            except ValueError:
                continue
    return False


def select_offlist_topics(
    data_root: Path,
    captured_at: datetime,
    current_queries: set[str],
) -> list[TrendWatchCandidate]:
    """Select due off-list topics: hourly for seven days, then once per day."""
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
        if not latest or not trend_has_heat(latest):
            continue
        last_capture = _parse_datetime(latest.get("captured_at")) or _parse_datetime(
            latest.get("capture_hour")
        )
        if not last_capture:
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

    return [candidate for _, candidate in sorted(selected, key=lambda item: item[0])]
