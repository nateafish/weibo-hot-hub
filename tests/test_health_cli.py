import json
import sys

import pytest

from weibo_hot_hub import health_cli


class FakeClient:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


def _common(monkeypatch) -> None:
    monkeypatch.setattr(health_cli, "cookie_from_env", lambda: "a=b")
    monkeypatch.setattr(health_cli, "mobile_cookie_from_env", lambda: "c=d")
    monkeypatch.setattr(health_cli, "hotlist_client", lambda _cookie: FakeClient())
    monkeypatch.setattr(health_cli, "mobile_client", lambda _cookie: FakeClient())
    monkeypatch.setattr(health_cli, "fetch_hotlist", lambda _http: [object()])


def test_mobile_sample_403_does_not_invalidate_logged_in_cookie(tmp_path, monkeypatch) -> None:
    _common(monkeypatch)
    monkeypatch.setattr(health_cli, "check_mobile_login", lambda _http: True)
    monkeypatch.setattr(
        health_cli,
        "collect_mobile_search_pages",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("403")),
    )
    monkeypatch.setattr(sys, "argv", ["health_cli", "--data-root", str(tmp_path)])

    health_cli.main()

    state = json.loads((tmp_path / "state/cookies.json").read_text())
    assert state["status"] == "valid"
    assert state["mobile"]["status"] == "valid"
    assert state["mobile"]["sample_status"] == "unavailable"


def test_mobile_login_false_is_invalid(tmp_path, monkeypatch) -> None:
    _common(monkeypatch)
    monkeypatch.setattr(health_cli, "check_mobile_login", lambda _http: False)
    monkeypatch.setattr(sys, "argv", ["health_cli", "--data-root", str(tmp_path)])

    with pytest.raises(SystemExit):
        health_cli.main()

    state = json.loads((tmp_path / "state/cookies.json").read_text())
    assert state["status"] == "invalid"
    assert state["mobile"]["status"] == "invalid"
