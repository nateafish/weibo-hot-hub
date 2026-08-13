import json
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from weibo_hot_hub.local_collector import (
    CollectorError,
    _set_github_secret,
    archive_paths,
    cookie_header,
    lease_context,
    redact,
    validate_outputs,
)


def test_github_secret_uses_stdin_not_command_arguments(monkeypatch) -> None:
    captured = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["input"] = kwargs.get("input")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("weibo_hot_hub.local_collector.subprocess.run", fake_run)
    _set_github_secret(Path("."), "owner/repo", "WEIBO_COOKIE", "private-value")

    assert "private-value" not in captured["args"]
    assert captured["input"] == "private-value"


def test_cookie_header_filters_by_host_and_expiry() -> None:
    cookies = [
        {"name": "SUB", "value": "x", "domain": ".weibo.com", "path": "/"},
        {"name": "M_SUB", "value": "y", "domain": ".weibo.cn", "path": "/"},
        {
            "name": "OLD",
            "value": "expired",
            "domain": ".weibo.com",
            "path": "/",
            "expires": time.time() - 1,
        },
    ]
    assert cookie_header(cookies, "s.weibo.com") == "SUB=x"
    assert cookie_header(cookies, "m.weibo.cn") == "M_SUB=y"


def test_hour_paths_and_lease_are_hour_scoped() -> None:
    assert archive_paths("2026/08/13/15") == (
        "data/hotlists/2026/08/13/15.json",
        "data/runs/2026/08/13/15.json",
    )
    assert lease_context("2026/08/13/15") == "local-collector/2026-08-13T15+08:00"


def test_redaction_removes_cookie_value() -> None:
    assert "secret" not in redact("Cookie: secret")
    assert "secret" not in redact("WEIBO_MOBILE_COOKIE=secret")


def test_validate_outputs_checks_rates_and_fatal_signals(tmp_path) -> None:
    key = "2026/08/13/15"
    hotlist, run = [tmp_path / item for item in archive_paths(key)]
    hotlist.parent.mkdir(parents=True)
    run.parent.mkdir(parents=True)
    hotlist.write_text(json.dumps({"count": 10, "topics": list(range(10))}))
    topics = [
        {"metrics": "saved", "posts": "saved", "ai": "unchanged"} for _ in range(10)
    ]
    run.write_text(json.dumps({"selected_count": 10, "topics": topics}))
    result = validate_outputs(
        tmp_path,
        key,
        min_metrics_rate=0.7,
        min_posts_rate=0.7,
        min_ai_rate=0.5,
    )
    assert result["metrics"] == 1

    topics[0]["posts"] = "failed"
    topics[0]["posts_error"] = "HTTP 429"
    run.write_text(json.dumps({"selected_count": 10, "topics": topics}))
    with pytest.raises(CollectorError, match="429"):
        validate_outputs(
            tmp_path,
            key,
            min_metrics_rate=0.7,
            min_posts_rate=0.7,
            min_ai_rate=0.5,
        )

    topics[0]["posts"] = "saved"
    topics[0].pop("posts_error")
    run.write_text(
        json.dumps(
            {
                "selected_count": 10,
                "topics": topics,
                "offlist_trends": [{"metrics": "failed", "metrics_error": "HTTP 403"}],
            }
        )
    )
    with pytest.raises(CollectorError, match="403"):
        validate_outputs(
            tmp_path,
            key,
            min_metrics_rate=0.7,
            min_posts_rate=0.7,
            min_ai_rate=0.5,
        )
