import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from weibo_hot_hub.trend_watch import (
    MAX_OFFLIST_PER_RUN,
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
    _topic(tmp_path, "recent", NOW - timedelta(days=2), NOW - timedelta(hours=1), [20000])
    _topic(tmp_path, "old-due", NOW - timedelta(days=8), NOW - timedelta(days=1), [20000])
    _topic(tmp_path, "old-done", NOW - timedelta(days=8), NOW - timedelta(hours=1), [20000])

    selected = select_offlist_topics(tmp_path, NOW, set())

    assert [(item.topic_id, item.cadence) for item in selected] == [
        ("old-due", "daily"),
        ("recent", "hourly"),
    ]


def test_current_and_cold_topics_are_not_selected(tmp_path: Path) -> None:
    _topic(tmp_path, "listed", NOW - timedelta(hours=1), NOW - timedelta(hours=1), [20000])
    _topic(tmp_path, "cold", NOW - timedelta(days=2), NOW - timedelta(hours=1), [0, 0])

    assert select_offlist_topics(tmp_path, NOW, {"#listed#"}) == []
    # Heat is decided on the most recent points only.
    assert trend_has_heat({"24h": {"read": [{"value": "12,000"}]}})
    assert not trend_has_heat({"24h": {"read": [{"value": 9_999}]}})
    # A single recent hot bucket keeps the topic alive even if older buckets are dead.
    assert trend_has_heat({"24h": {"read": [{"value": 0}, {"value": 0}, {"value": 15_000}]}})
    assert is_rate_limit_error("HTTPStatusError: Client error '418 '")
    assert not is_rate_limit_error("Topic API error: no data")


def test_stale_records_are_never_used_to_drop_a_topic(tmp_path: Path) -> None:
    # Stale record with low values: the topic must still be selected so the
    # heat decision is re-made on fresh data during collection.
    _topic(
        tmp_path,
        "stale",
        NOW - timedelta(days=2),
        NOW - timedelta(hours=26),
        [1, 1, 1],
    )

    selected = select_offlist_topics(tmp_path, NOW, set())

    assert [item.topic_id for item in selected] == ["stale"]


def test_selection_is_capped_and_oldest_first(tmp_path: Path) -> None:
    for index in range(5):
        _topic(
            tmp_path,
            f"t{index}",
            NOW - timedelta(days=1),
            NOW - timedelta(hours=5 - index),
            [20000],
        )

    selected = select_offlist_topics(tmp_path, NOW, set(), max_topics=3)

    assert [item.topic_id for item in selected] == ["t0", "t1", "t2"]
    assert len(select_offlist_topics(tmp_path, NOW, set())) == 5
    assert MAX_OFFLIST_PER_RUN >= 1
