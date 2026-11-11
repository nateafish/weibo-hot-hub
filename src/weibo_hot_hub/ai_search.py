from __future__ import annotations

import html
import json
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup

from .weibo import (
    LoginRequired, ParseError, Post, _sleep_with_jitter, assert_authenticated,
    canonical_https, parse_search_page,
)


AI_ENDPOINT = "https://ai.s.weibo.com/api/wis/show.json"
REFUSAL_TEXTS = (
    "抱歉，这个问题我暂时无法回答",
    "换个问题试试吧",
)


class AiSearchError(RuntimeError):
    pass


REFERENCE_CATEGORIES = {
    "gold_orange_v": "金橙V",
    "verified": "认证用户",
    "normal": "普通用户",
    "media": "媒体",
}


@dataclass(frozen=True)
class AiReferences:
    percentages: dict[str, float]
    members: dict[str, str | None]
    inline_names: dict[str, str]


@dataclass(frozen=True)
class AiAnswer:
    query: str
    version: str | None
    initial_version: str | None
    upstream_md5: str | None
    page_id: str | None
    status: int | None
    refused: bool
    markdown: str
    sources: list[str]
    references: AiReferences | None = None


def ai_headers(cookie: str) -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Cookie": cookie,
        "Origin": "https://s.weibo.com",
        "Referer": "https://s.weibo.com/aisearch",
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }


def ai_client(cookie: str) -> httpx.Client:
    return httpx.Client(headers=ai_headers(cookie), timeout=90, follow_redirects=True)


def fetch_ai_answer(http: httpx.Client, topic: str) -> AiAnswer:
    now = int(time.time())
    response = http.post(
        AI_ENDPOINT,
        data={
            "query": topic,
            "content_type": "loop",
            "request_id": str(now),
            "request_time": "0",
            "search_source": "default_init",
            "sid": "pc_search",
            "vstyle": "1",
            "cot": "1",
            "speed": "full",
            "loop_num": "1",
        },
    )
    response.raise_for_status()
    if "passport.weibo.com" in str(response.url) or "/visitor/" in str(response.url):
        raise LoginRequired("AI search redirected to login")
    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise AiSearchError("AI search returned non-JSON") from exc
    if not isinstance(payload, dict):
        raise AiSearchError("AI search payload is not an object")
    return normalize_ai_answer({**payload, "query": payload.get("query") or topic})


def _scheme_links(value: Any) -> list[tuple[str, str]]:
    if not isinstance(value, dict):
        return []
    data = value.get("data") if isinstance(value.get("data"), dict) else {}
    candidates = data.get("quote_list") if isinstance(data.get("quote_list"), list) else []
    if not candidates and data.get("scheme"):
        candidates = [data]
    output: list[tuple[str, str]] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        url = canonical_https(str(item.get("scheme") or ""))
        if url:
            output.append((str(item.get("name") or item.get("index") or "微博来源"), url))
    return output


def _replace_custom_block(match: re.Match[str]) -> str:
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError:
        return ""
    links = _scheme_links(value)
    return " " + " ".join(f"[{name}]({url})" for name, url in links) if links else ""


def _replace_media_block(match: re.Match[str]) -> str:
    soup = BeautifulSoup(match.group(1), "html.parser")
    links: list[str] = []
    for item in soup.select("[data-scheme]"):
        url = canonical_https(str(item.get("data-scheme") or ""))
        name_node = item.select_one(".nick")
        name = name_node.get_text(strip=True) if name_node else "微博素材"
        if url:
            rendered = f"[{name}]({url})"
            if rendered not in links:
                links.append(rendered)
    return "\n\n" + " · ".join(links) + "\n\n" if links else "\n"


def message_to_markdown(message: str) -> str:
    value = re.sub(r"<think\b[^>]*>.*?</think>", "", message, flags=re.DOTALL | re.I)
    value = re.sub(
        r"```wbCustomBlock(\{.*?\})```", _replace_custom_block, value, flags=re.DOTALL
    )
    value = re.sub(
        r"<media-block>(.*?)</media-block>", _replace_media_block, value, flags=re.DOTALL | re.I
    )
    soup = BeautifulSoup(value, "html.parser")
    for br in soup.find_all("br"):
        br.replace_with("\n")
    value = html.unescape(soup.get_text("", strip=False))
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _normalize_references(raw: Any, markdown: str) -> AiReferences | None:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None

    percentages: dict[str, float] = {}
    members: dict[str, str | None] = {}
    for category in REFERENCE_CATEGORIES:
        ratio = re.fullmatch(r"(\d+(?:\.\d+)?)\s*%?", str(raw.get(f"{category}_ratio", "")).strip())
        if ratio and float(ratio[1]) <= 100:
            percentages[category] = float(ratio[1])
        ids = raw.get(f"{category}_mids")
        if isinstance(ids, list):
            for mid in map(str, ids):
                if mid.isdecimal():
                    members.setdefault(mid, category)

    ranks = raw.get("ref_mid_rank")
    if isinstance(ranks, dict):
        for mid in ranks:
            if mid.isdecimal():
                members.setdefault(mid, None)

        def reference_rank(mid: str) -> int:
            item = ranks.get(mid)
            rank = item.get("rank") if isinstance(item, dict) else None
            return int(str(rank)) if str(rank).isdecimal() else len(members) + 1

        members = dict(sorted(members.items(), key=lambda item: reference_rank(item[0])))

    if not members and not percentages:
        return None
    inline_names = {
        mid: name.strip()
        for name, mid in re.findall(r"\[([^\]\n]+)\]\(https://m\.weibo\.cn/(?:detail|status(?:/detail)?)/(\d+)(?:[/?#][^\s)]*)?\)", markdown)
        if mid in members and not re.fullmatch(r"\s*(?:\d+|微博来源|微博素材)\s*", name)
    }
    return AiReferences(percentages, members, inline_names)


def normalize_ai_answer(payload: dict[str, Any]) -> AiAnswer:
    message = str(payload.get("msg") or "")
    markdown = message_to_markdown(message)
    refused = any(marker in message or marker in markdown for marker in REFUSAL_TEXTS)
    sources: list[str] = []
    for raw in payload.get("link_list") or []:
        normalized = canonical_https(str(raw))
        if normalized and normalized not in sources:
            sources.append(normalized)
    status = payload.get("status")
    return AiAnswer(
        query=str(payload.get("query") or payload.get("display_query") or ""),
        version=str(payload.get("version")) if payload.get("version") else None,
        initial_version=(
            str(payload.get("initial_version")) if payload.get("initial_version") else None
        ),
        upstream_md5=str(payload.get("unify_md5")) if payload.get("unify_md5") else None,
        page_id=str(payload.get("page_id")) if payload.get("page_id") else None,
        status=int(status) if isinstance(status, int) else None,
        refused=refused,
        markdown=markdown,
        sources=sources,
        references=_normalize_references(payload.get("reliable_tips"), markdown),
    )


def reference_list_url(topic: str, page: int = 1, category: str = "") -> str:
    query = httpx.QueryParams(
        {"q": topic, "res_type": "ref_blog", "u_type": category, "page": page}
    )
    return f"https://s.weibo.com/aisearchmore?{query}"


def fetch_reference_posts(http: httpx.Client, topic: str, wanted: set[str]) -> dict[str, Post]:
    """Resolve posts by the answer's IDs, even if the search page has since changed."""
    found: dict[str, Post] = {}
    pages = {1}
    visited: set[int] = set()
    while pages:
        page = min(pages)
        pages.remove(page)
        visited.add(page)
        if len(visited) > 1:
            _sleep_with_jitter(0.4, 0.2)
        try:
            response = http.get(reference_list_url(topic, page), timeout=12)
            response.raise_for_status()
            assert_authenticated(response)
            posts = parse_search_page(response.text)
        except (httpx.HTTPError, LoginRequired, ParseError):
            break

        for post in posts:
            if post.mid in wanted and (post.mid not in found or post.username):
                found[post.mid] = post
        if all(mid in found and found[mid].username for mid in wanted):
            break
        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.select('#pl_feedlist_index a[href*="page="]'):
            link = urlparse(str(anchor.get("href", "")))
            params = parse_qs(link.query)
            number = params.get("page", [""])[0]
            if (
                link.path == "/aisearchmore" and params.get("res_type") == ["ref_blog"]
                and params.get("q") == [topic] and "u_type" not in params
                and number.isdecimal() and int(number) not in visited
            ):
                pages.add(int(number))
    return found

