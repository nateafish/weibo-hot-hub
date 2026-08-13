import pytest

from weibo_hot_hub.hourly import (
    HourlyValidationError,
    collect_post_pages,
    validate_report,
)
from weibo_hot_hub.weibo import ParseError, Post


def report(posts: int) -> dict:
    return {
        "selected_count": 10,
        "summary": {
            "metrics_saved": 10,
            "posts_saved": posts,
            "ai_saved": 8,
            "ai_unchanged": 1,
            "ai_refused": 1,
        },
    }


def test_hourly_validation_accepts_healthy_run() -> None:
    validate_report(report(10))


def test_hourly_validation_rejects_missing_posts() -> None:
    with pytest.raises(HourlyValidationError, match="posts=0%"):
        validate_report(report(0))


def test_hourly_posts_switch_to_pc_after_mobile_403(monkeypatch) -> None:
    mobile_calls = []
    pc_calls = []

    def mobile(*_args, **_kwargs):
        mobile_calls.append(True)
        raise ParseError("Mobile API failed: 403")

    def pc(_http, topic, pages):
        pc_calls.append((topic, pages))
        return [[Post("1", None, None, None, "body", None)]]

    monkeypatch.setattr("weibo_hot_hub.hourly.collect_mobile_search_pages", mobile)
    monkeypatch.setattr("weibo_hot_hub.hourly.collect_search_pages", pc)

    pages, use_mobile = collect_post_pages(object(), object(), "#测试#", 1, True)

    assert len(pages[0]) == 1
    assert use_mobile is False
    assert len(mobile_calls) == 1
    assert pc_calls == [("#测试#", 1)]
