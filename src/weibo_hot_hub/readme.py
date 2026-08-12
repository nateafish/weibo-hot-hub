from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


COOKIE_BEGIN = "<!-- BEGIN COOKIE_STATUS -->"
COOKIE_END = "<!-- END COOKIE_STATUS -->"
HOTLIST_BEGIN = "<!-- BEGIN TODAY_HOTLIST -->"
HOTLIST_END = "<!-- END TODAY_HOTLIST -->"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _replace_block(source: str, begin: str, end: str, body: str) -> str:
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.DOTALL)
    replacement = f"{begin}\n\n{body.strip()}\n\n{end}"
    if not pattern.search(source):
        raise ValueError(f"README marker is missing: {begin}")
    return pattern.sub(lambda _: replacement, source, count=1)


def _status_icon(value: str | None) -> str:
    return "✅ 有效" if value == "valid" else "❌ 已失效"


def _display_time(value: str | None) -> str:
    if not value:
        return "未知"
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return value


def render_cookie_status(state: dict[str, Any]) -> str:
    overall = _status_icon(str(state.get("status") or ""))
    pc = _status_icon(str((state.get("pc") or {}).get("status") or ""))
    mobile = _status_icon(str((state.get("mobile") or {}).get("status") or ""))
    checked_at = _display_time(str(state.get("checked_at") or ""))
    return (
        f"**微博 Cookie**：{overall} ｜ PC：{pc} ｜ 移动端：{mobile} "
        f"｜ 最近检测：{checked_at}（北京时间）"
    )


def _markdown_text(value: Any) -> str:
    return str(value or "").replace("\\", "\\\\").replace("|", "\\|").replace("[", "\\[").replace("]", "\\]")


def _heat_value(topic: dict[str, Any]) -> int | None:
    value = topic.get("heat")
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def sort_topics_by_heat(topics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed = list(enumerate(topics))
    indexed.sort(
        key=lambda item: (
            _heat_value(item[1]) is None,
            -(_heat_value(item[1]) or 0),
            int(item[1].get("rank") or item[0] + 1),
            item[0],
        )
    )
    return [topic for _, topic in indexed]


def render_hotlist(snapshot: dict[str, Any], archive_path: Path) -> str:
    captured_at = str(snapshot.get("captured_at") or "")
    display_time = _display_time(captured_at)
    source_url = str(snapshot.get("source_url") or "https://s.weibo.com/top/summary")
    topics = sort_topics_by_heat(list(snapshot.get("topics") or []))
    rows = [
        f"## 今日微博热搜（{display_time[:10]}）",
        "",
        f"最后更新：{display_time}（北京时间）｜[微博热搜榜](<{source_url}>)｜[本次 JSON](<{archive_path.as_posix()}>)｜[历史归档](./data/hotlists/)",
        "",
        "| 热度排名 | 话题 | 热度 | 标记 |",
        "| ---: | --- | ---: | :---: |",
    ]
    for position, topic in enumerate(topics, start=1):
        title = _markdown_text(topic.get("title"))
        url = str(topic.get("url") or source_url)
        heat = _heat_value(topic)
        heat_text = f"{heat:,}" if heat is not None else "—"
        label = _markdown_text(topic.get("label")) or "—"
        rows.append(f"| {position} | [{title}](<{url}>) | {heat_text} | {label} |")
    return "\n".join(rows)


def latest_hotlist(data_root: Path) -> tuple[Path, dict[str, Any]]:
    paths = sorted((data_root / "hotlists").glob("*/*/*/*.json"))
    if not paths:
        raise FileNotFoundError("No hotlist snapshots found")
    path = paths[-1]
    return path, _load_json(path)


def update_readme(data_root: Path, readme_path: Path) -> None:
    source = readme_path.read_text(encoding="utf-8")
    state = _load_json(data_root / "state" / "cookies.json")
    hotlist_path, snapshot = latest_hotlist(data_root)
    try:
        archive_path = hotlist_path.relative_to(readme_path.parent)
    except ValueError:
        archive_path = hotlist_path
    rendered = _replace_block(
        source, COOKIE_BEGIN, COOKIE_END, render_cookie_status(state)
    )
    rendered = _replace_block(
        rendered,
        HOTLIST_BEGIN,
        HOTLIST_END,
        render_hotlist(snapshot, archive_path),
    )
    readme_path.write_text(rendered.rstrip() + "\n", encoding="utf-8")
