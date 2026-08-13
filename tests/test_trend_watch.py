import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from weibo_hot_hub.trend_watch import (
    is_rate_limit_error,
    select_offlist_topics,
    trend_has_heat,
)


NOW = datetime(2026, 8, 13, 20, 0, tzinfo=ZoneInfo("Asia/Shanghai"))


def _topic(
    root: Path,
    topic_id: str,
    last_seen: datetime,
    last_capture: datetime,
    values: list[int],
) -> None:
    topic_root = root / "topics" / topic_id
    topic_root.mkdir(parents=True)
    (topic_root / "meta.json").write_text(
        json.dumps(
            {
                "topic_id": topic_id,
                "title": topic_id,
                "query": f"#{topic_id}#",
                "last_seen_at": last_seen.isoformat(),
            }
        )
    )
    trend = topic_root / "trends" / f"{last_capture:%Y}" / f"{last_capture:%m-%d}.jsonl"
    trend.parent.mkdir(parents=True)
    trend.write_text(
        json.dumps(
            {
                "captured_at": last_capture.isoformat(),
                "capture_hour": last_capture.strftime("%Y-%m-%dT%H%z"),
                "24h": {"read": [{"value": value} for value in values]},
            }
        )
        + "\n"
    )


def test_offlist_topics_are_hourly_for_seven_days_then_daily(tmp_path: Path) -> None:
    _topic(tmp_path, "recent", NOW - timedelta(days=2), NOW - timedelta(hours=1), [1])
    _topic(tmp_path, "old-due", NOW - timedelta(days=8), NOW - timedelta(days=1), [1])
    _topic(tmp_path, "old-done", NOW - timedelta(days=8), NOW - timedelta(hours=1), [1])

    selected = select_offlist_topics(tmp_path, NOW, set())

    assert [(item.topic_id, item.cadence) for item in selected] == [
        ("old-due", "daily"),
        ("recent", "hourly"),
    ]


def test_current_and_cold_topics_are_not_selected(tmp_path: Path) -> None:
    _topic(tmp_path, "listed", NOW - timedelta(hours=1), NOW - timedelta(hours=1), [1])
    _topic(tmp_path, "cold", NOW - timedelta(days=2), NOW - timedelta(hours=1), [0, 0])

    assert select_offlist_topics(tmp_path, NOW, {"#listed#"}) == []
    assert trend_has_heat({"24h": {"read": [{"value": "1,001"}]}})
    assert not trend_has_heat({"24h": {"read": [{"value": 0}]}})
    assert is_rate_limit_error("HTTPStatusError: Client error '418 '")
    assert not is_rate_limit_error("Topic API error: no data")
