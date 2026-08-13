from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .storage import atomic_json, save_post_pages
from .weibo import (
    ParseError,
    _sleep_with_jitter,
    check_mobile_login,
    collect_mobile_search_pages,
    collect_search_pages,
    client,
    cookie_from_env,
    mobile_client,
    mobile_cookie_from_env,
    unique_posts,
)


def repair_posts(data_root: Path, hour: str, pages: int = 1) -> dict[str, Any]:
    run_path = data_root / "runs" / f"{hour}.json"
    if not run_path.is_file():
        raise FileNotFoundError(f"run record not found: {run_path}")
    report = json.loads(run_path.read_text(encoding="utf-8"))
    captured_at = datetime.fromisoformat(str(report["captured_at"]))
    pending = [item for item in report.get("topics") or [] if item.get("posts") != "saved"]
    if not pending:
        return report

    use_mobile = True
    with mobile_client(mobile_cookie_from_env()) as mobile_http, client(
        cookie_from_env()
    ) as pc_http:
        if not check_mobile_login(mobile_http):
            raise RuntimeError("WEIBO_MOBILE_COOKIE failed /api/config login check")
        for index, item in enumerate(pending):
            topic_id = str(item.get("topic_id") or "")
            if not topic_id:
                raise RuntimeError(f"missing topic_id for {item.get('title')}")
            query = str(item["query"])
            if use_mobile:
                try:
                    post_pages = collect_mobile_search_pages(
                        mobile_http,
                        query,
                        pages=pages,
                        verify_login=False,
                    )
                except ParseError as exc:
                    if "403" not in str(exc):
                        raise
                    use_mobile = False
                    post_pages = collect_search_pages(pc_http, query, pages=pages)
            else:
                post_pages = collect_search_pages(pc_http, query, pages=pages)
            save_post_pages(data_root, topic_id, captured_at, post_pages)
            item["posts"] = "saved"
            item["post_count"] = len(unique_posts(post_pages))
            item.pop("posts_error", None)
            if index + 1 < len(pending):
                _sleep_with_jitter(1.5, 0.5)

    report["summary"]["posts_saved"] = sum(
        item.get("posts") == "saved" for item in report["topics"]
    )
    report["posts_repaired_at"] = datetime.now(captured_at.tzinfo).isoformat()
    atomic_json(run_path, report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Repair missing posts for an archived hour")
    parser.add_argument("--hour", required=True, help="Beijing hour as YYYY/MM/DD/HH")
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    args = parser.parse_args()
    if not 1 <= args.pages <= 10:
        parser.error("--pages must be between 1 and 10")
    report = repair_posts(args.data_root, args.hour, args.pages)
    print(
        f"hour={args.hour} posts_saved={report['summary']['posts_saved']} "
        f"selected={report['selected_count']}"
    )


if __name__ == "__main__":
    main()
