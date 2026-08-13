from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .ai_search import ai_client, fetch_ai_answer
from .hotlist import fetch_hotlist, hotlist_client, save_hotlist
from .storage import (
    atomic_json,
    save_ai_answer,
    save_post_pages,
    save_topic_bundle,
)
from .topic import fetch_topic_bundle, topic_client
from .trend_watch import collect_offlist_trends
from .weibo import (
    ParseError,
    ai_search_url,
    check_mobile_login,
    collect_mobile_search_pages,
    collect_search_pages,
    client,
    cookie_from_env,
    mobile_client,
    mobile_cookie_from_env,
    _sleep_with_jitter,
    unique_posts,
)


class HourlyValidationError(RuntimeError):
    pass


def _error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"[:500]


def validate_report(report: dict[str, Any]) -> None:
    selected = int(report.get("selected_count") or 0)
    if selected <= 0:
        raise HourlyValidationError("hourly run selected no topics")
    summary = report.get("summary") or {}
    rates = {
        "metrics": int(summary.get("metrics_saved") or 0) / selected,
        "posts": int(summary.get("posts_saved") or 0) / selected,
        "ai": sum(
            int(summary.get(key) or 0)
            for key in ("ai_saved", "ai_unchanged", "ai_refused")
        )
        / selected,
    }
    minimums = {"metrics": 0.7, "posts": 0.7, "ai": 0.5}
    failed = [name for name, rate in rates.items() if rate < minimums[name]]
    if failed:
        detail = ", ".join(f"{name}={rates[name]:.0%}" for name in failed)
        raise HourlyValidationError(f"hourly success-rate validation failed: {detail}")


def collect_post_pages(
    mobile_http: Any,
    pc_http: Any,
    topic: str,
    pages: int,
    use_mobile: bool,
) -> tuple[list[list[Any]], bool]:
    if use_mobile:
        try:
            return (
                collect_mobile_search_pages(
                    mobile_http,
                    topic,
                    pages=pages,
                    verify_login=False,
                ),
                True,
            )
        except ParseError as exc:
            if "403" not in str(exc):
                raise
    return collect_search_pages(pc_http, topic, pages=pages), False


def run_hourly(data_root: Path, pages: int = 1, max_topics: int = 0) -> dict[str, Any]:
    captured_at = datetime.now(ZoneInfo("Asia/Shanghai")).replace(
        minute=0, second=0, microsecond=0
    )
    pc_cookie = cookie_from_env()
    mobile_cookie = mobile_cookie_from_env()
    report: dict[str, Any] = {
        "captured_at": captured_at.isoformat(),
        "pages_per_topic": pages,
        "topic_delay_seconds": {"base": 1.5, "jitter": 0.5},
        "topics": [],
        "offlist_trends": [],
    }

    with hotlist_client(pc_cookie) as pc_http:
        hot_topics = fetch_hotlist(pc_http)
    save_hotlist(data_root, captured_at, hot_topics)
    selected = hot_topics[:max_topics] if max_topics > 0 else hot_topics
    report["hotlist_count"] = len(hot_topics)
    report["selected_count"] = len(selected)

    with (
        topic_client() as public_http,
        mobile_client(mobile_cookie) as mobile_http,
        client(pc_cookie) as post_pc_http,
        ai_client(pc_cookie) as ai_http,
    ):
        if not check_mobile_login(mobile_http):
            raise RuntimeError("WEIBO_MOBILE_COOKIE failed /api/config login check")
        use_mobile_posts = True
        for index, hot_topic in enumerate(selected):
            item: dict[str, Any] = {
                "rank": hot_topic.rank,
                "title": hot_topic.title,
                "query": hot_topic.query,
                "metrics": "pending",
                "posts": "pending",
                "ai": "pending",
            }
            try:
                bundle = fetch_topic_bundle(public_http, hot_topic.query, captured_at)
                item["topic_id"] = bundle.topic_id
                save_topic_bundle(
                    data_root,
                    bundle,
                    captured_at,
                    query=hot_topic.query,
                )
                item["metrics"] = "saved"
            except Exception as exc:
                item["metrics"] = "failed"
                item["metrics_error"] = _error(exc)
                report["topics"].append(item)
                if index + 1 < len(selected):
                    _sleep_with_jitter(1.5, 0.5)
                continue

            try:
                post_pages, use_mobile_posts = collect_post_pages(
                    mobile_http,
                    post_pc_http,
                    hot_topic.query,
                    pages,
                    use_mobile_posts,
                )
                save_post_pages(data_root, bundle.topic_id, captured_at, post_pages)
                item["posts"] = "saved"
                item["post_count"] = len(unique_posts(post_pages))
            except Exception as exc:
                item["posts"] = "failed"
                item["posts_error"] = _error(exc)

            try:
                answer = fetch_ai_answer(ai_http, hot_topic.query)
                output = save_ai_answer(
                    data_root,
                    bundle.topic_id,
                    captured_at,
                    answer,
                    ai_search_url(hot_topic.query),
                )
                item["ai"] = "refused" if answer.refused else ("saved" if output else "unchanged")
            except Exception as exc:
                item["ai"] = "failed"
                item["ai_error"] = _error(exc)
            report["topics"].append(item)
            if index + 1 < len(selected):
                _sleep_with_jitter(1.5, 0.5)

        report["offlist_trends"] = collect_offlist_trends(
            public_http,
            data_root,
            captured_at,
            {topic.query for topic in hot_topics},
        )

    report["summary"] = {
        "metrics_saved": sum(item["metrics"] == "saved" for item in report["topics"]),
        "posts_saved": sum(item["posts"] == "saved" for item in report["topics"]),
        "ai_saved": sum(item["ai"] == "saved" for item in report["topics"]),
        "ai_unchanged": sum(item["ai"] == "unchanged" for item in report["topics"]),
        "ai_refused": sum(item["ai"] == "refused" for item in report["topics"]),
        "offlist_selected": len(report["offlist_trends"]),
        "offlist_saved": sum(
            item["metrics"] == "saved" for item in report["offlist_trends"]
        ),
        "offlist_stopped": sum(
            item.get("metrics") == "saved" and not item.get("has_heat")
            for item in report["offlist_trends"]
        ),
    }
    report_path = (
        data_root
        / "runs"
        / captured_at.strftime("%Y")
        / captured_at.strftime("%m")
        / captured_at.strftime("%d")
        / f"{captured_at:%H}.json"
    )
    atomic_json(report_path, report)
    validate_report(report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--max-topics", type=int, default=0)
    args = parser.parse_args()
    if not 1 <= args.pages <= 10:
        parser.error("--pages must be between 1 and 10")
    if args.max_topics < 0:
        parser.error("--max-topics cannot be negative")
    report = run_hourly(args.data_root, args.pages, args.max_topics)
    print(report["summary"])


if __name__ == "__main__":
    main()
