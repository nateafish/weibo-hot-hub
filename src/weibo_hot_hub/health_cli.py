from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .hotlist import fetch_hotlist, hotlist_client
from .storage import atomic_json
from .weibo import (
    check_mobile_login,
    collect_mobile_search_pages,
    cookie_from_env,
    mobile_client,
    mobile_cookie_from_env,
)


def _error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"[:300]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topic", default="#微博热搜#")
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    args = parser.parse_args()
    checked_at = datetime.now(ZoneInfo("Asia/Shanghai")).replace(microsecond=0)
    state = {
        "checked_at": checked_at.isoformat(),
        "pc": {"status": "invalid"},
        "mobile": {"status": "invalid"},
    }

    try:
        with hotlist_client(cookie_from_env()) as http:
            topics = fetch_hotlist(http)
        state["pc"] = {"status": "valid", "hotlist_topics": len(topics)}
    except Exception as exc:
        state["pc"]["reason"] = _error(exc)

    try:
        with mobile_client(mobile_cookie_from_env()) as http:
            logged_in = check_mobile_login(http)
            if not logged_in:
                raise RuntimeError("/api/config data.login != true")
            state["mobile"] = {"status": "valid", "login": True}
            try:
                pages = collect_mobile_search_pages(
                    http,
                    args.topic,
                    pages=1,
                    delay=0,
                    jitter=0,
                    fetch_full_text=False,
                    verify_login=False,
                )
            except Exception as exc:
                state["mobile"]["sample_status"] = "unavailable"
                state["mobile"]["sample_reason"] = _error(exc)
            else:
                state["mobile"]["sample_status"] = "valid"
                state["mobile"]["sample_posts"] = sum(len(page) for page in pages)
    except Exception as exc:
        state["mobile"]["reason"] = _error(exc)

    state["status"] = (
        "valid"
        if state["pc"]["status"] == state["mobile"]["status"] == "valid"
        else "invalid"
    )
    path = args.data_root / "state" / "cookies.json"
    atomic_json(path, state)
    print(f"status={state['status']} pc={state['pc']['status']} mobile={state['mobile']['status']}")
    if state["status"] != "valid":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
