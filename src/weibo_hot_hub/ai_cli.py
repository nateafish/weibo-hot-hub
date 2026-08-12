from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .ai_search import ai_client, fetch_ai_answer
from .storage import save_ai_answer
from .topic import fetch_topic_bundle, topic_client
from .weibo import ai_search_url, cookie_from_env


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("topic")
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    args = parser.parse_args()
    captured_at = datetime.now(ZoneInfo("Asia/Shanghai")).replace(microsecond=0)
    with topic_client() as public_http:
        bundle = fetch_topic_bundle(public_http, args.topic, captured_at)
    with ai_client(cookie_from_env()) as http:
        answer = fetch_ai_answer(http, args.topic)
    output = save_ai_answer(
        args.data_root, bundle.topic_id, captured_at, answer, ai_search_url(args.topic)
    )
    print(output or "unchanged-or-refused")


if __name__ == "__main__":
    main()
