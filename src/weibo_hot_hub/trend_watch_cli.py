from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .storage import atomic_json
from .topic import topic_client
from .trend_watch import collect_offlist_trends


def _latest_hotlist(data_root: Path) -> dict[str, Any]:
    paths = sorted((data_root / "hotlists").glob("*/*/*/*.json"))
    if not paths:
        raise FileNotFoundError("No hotlist snapshot is available")
    value = json.loads(paths[-1].read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Latest hotlist is not a JSON object")
    return value


def run_backfill(data_root: Path) -> dict[str, Any]:
    captured_at = datetime.now(ZoneInfo("Asia/Shanghai")).replace(
        minute=0, second=0, microsecond=0
    )
    hotlist = _latest_hotlist(data_root)
    queries = {
        str(topic.get("query") or topic.get("title") or "")
        for topic in hotlist.get("topics") or []
        if isinstance(topic, dict)
    }
    with topic_client() as http:
        results = collect_offlist_trends(http, data_root, captured_at, queries)
    report = {
        "captured_at": captured_at.isoformat(),
        "source_hotlist_at": hotlist.get("captured_at"),
        "offlist_trends": results,
        "summary": {
            "selected": len(results),
            "saved": sum(item.get("metrics") == "saved" for item in results),
            "stopped": sum(
                item.get("metrics") == "saved" and not item.get("has_heat")
                for item in results
            ),
            "failed": sum(item.get("metrics") == "failed" for item in results),
        },
    }
    output = (
        data_root
        / "trend-watch-runs"
        / captured_at.strftime("%Y")
        / captured_at.strftime("%m")
        / captured_at.strftime("%d")
        / f"{captured_at:%H}.json"
    )
    atomic_json(output, report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    args = parser.parse_args()
    print(run_backfill(args.data_root)["summary"])


if __name__ == "__main__":
    main()
