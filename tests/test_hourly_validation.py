import pytest

from weibo_hot_hub.hourly import HourlyValidationError, validate_report


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
