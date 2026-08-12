from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .storage import save_topic_bundle
from .topic import fetch_topic_bundle, topic_client


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("topic")
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    args = parser.parse_args()
    captured_at = datetime.now(ZoneInfo("Asia/Shanghai")).replace(minute=0, second=0, microsecond=0)
    with topic_client() as http:
        bundle = fetch_topic_bundle(http, args.topic, captured_at)
    for path in save_topic_bundle(args.data_root, bundle, captured_at):
        print(path)


if __name__ == "__main__":
    main()

