from __future__ import annotations

import argparse
import json
from dataclasses import asdict

from .weibo import collect_mobile_search_pages, cookie_from_env, mobile_client


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("topic")
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--health-only", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.pages <= 10:
        parser.error("--pages must be between 1 and 10")

    cookie = cookie_from_env()
    with mobile_client(cookie) as http:
        pages = collect_mobile_search_pages(
            http,
            args.topic,
            pages=1 if args.health_only else args.pages,
            fetch_full_text=not args.health_only,
        )
    print(
        json.dumps(
            {
                "status": "valid",
                "pages": len(pages),
                "posts": sum(len(page) for page in pages),
                "items": [] if args.health_only else [[asdict(post) for post in page] for page in pages],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
