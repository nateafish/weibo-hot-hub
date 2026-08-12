from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .storage import save_post_pages
from .topic import fetch_topic_bundle, topic_client
from .weibo import (
    collect_mobile_search_pages,
    mobile_client,
    mobile_cookie_from_env,
    unique_posts,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("topic")
    parser.add_argument("--pages", type=int, default=10)
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    args = parser.parse_args()
    if not 1 <= args.pages <= 10:
        parser.error("--pages must be between 1 and 10")
    captured_at = datetime.now(ZoneInfo("Asia/Shanghai")).replace(minute=0, second=0, microsecond=0)
    with topic_client() as public_http:
        bundle = fetch_topic_bundle(public_http, args.topic, captured_at)
    with mobile_client(mobile_cookie_from_env()) as http:
        pages = collect_mobile_search_pages(http, args.topic, pages=args.pages)
    written = save_post_pages(args.data_root, bundle.topic_id, captured_at, pages)
    print(
        f"pages={len(pages)} unique_posts={len(unique_posts(pages))} "
        f"written_files={len(written)}"
    )


if __name__ == "__main__":
    main()
