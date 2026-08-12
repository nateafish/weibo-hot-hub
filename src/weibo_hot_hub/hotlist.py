from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .storage import atomic_json
from .weibo import LoginRequired, cookie_from_env


HOTLIST_URL = "https://s.weibo.com/top/summary"


@dataclass(frozen=True)
class HotTopic:
    rank: int
    title: str
    query: str
    url: str
    heat: int | None
    label: str | None


def hotlist_client(cookie: str) -> httpx.Client:
    return httpx.Client(
        headers={
            "Cookie": cookie,
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
            "Referer": "https://weibo.com/",
            "Accept-Language": "zh-CN,zh;q=0.9",
        },
        timeout=30,
        follow_redirects=True,
    )


def parse_hotlist(source: str) -> list[HotTopic]:
    soup = BeautifulSoup(source, "html.parser")
    result: list[HotTopic] = []
    seen: set[str] = set()
    for row in soup.select("table tbody tr"):
        anchor = row.select_one('td.td-02 a[href*="/weibo?q="]')
        if anchor is None:
            continue
        title = anchor.get_text(" ", strip=True)
        href = str(anchor.get("href") or "")
        if not title or title in seen:
            continue
        seen.add(title)
        query = (parse_qs(urlparse(href).query).get("q") or [f"#{title}#"])[0]
        rank_node = row.select_one("td.td-01")
        rank_text = rank_node.get_text(strip=True) if rank_node else ""
        rank = int(rank_text) if rank_text.isdigit() else len(result) + 1
        heat_node = row.select_one("td.td-02 span")
        heat_text = heat_node.get_text(strip=True) if heat_node else ""
        heat = int(heat_text) if heat_text.isdigit() else None
        label_node = row.select_one("td.td-03")
        label = label_node.get_text(" ", strip=True) if label_node else None
        result.append(
            HotTopic(
                rank=rank,
                title=title,
                query=query,
                url=urljoin("https://s.weibo.com", href),
                heat=heat,
                label=label or None,
            )
        )
    if not result:
        raise LoginRequired("No hot topics found; Cookie may be invalid or page changed")
    return result


def fetch_hotlist(http: httpx.Client) -> list[HotTopic]:
    response = http.get(HOTLIST_URL)
    response.raise_for_status()
    if "passport.weibo.com" in str(response.url) or "/visitor/" in str(response.url):
        raise LoginRequired("Hotlist redirected to login")
    return parse_hotlist(response.text)


def save_hotlist(root: Path, captured_at: datetime, topics: list[HotTopic]) -> Path:
    path = (
        root
        / "hotlists"
        / captured_at.strftime("%Y")
        / captured_at.strftime("%m")
        / captured_at.strftime("%d")
        / f"{captured_at:%H}.json"
    )
    atomic_json(
        path,
        {
            "captured_at": captured_at.isoformat(),
            "source_url": HOTLIST_URL,
            "count": len(topics),
            "topics": [asdict(topic) for topic in topics],
        },
    )
    return path

