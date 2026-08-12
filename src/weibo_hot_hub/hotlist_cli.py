from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .hotlist import fetch_hotlist, hotlist_client, save_hotlist
from .weibo import cookie_from_env


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    args = parser.parse_args()
    captured_at = datetime.now(ZoneInfo("Asia/Shanghai")).replace(minute=0, second=0, microsecond=0)
    with hotlist_client(cookie_from_env()) as http:
        topics = fetch_hotlist(http)
    print(save_hotlist(args.data_root, captured_at, topics))


if __name__ == "__main__":
    main()

