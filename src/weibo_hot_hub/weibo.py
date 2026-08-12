from __future__ import annotations

import html
import os
import random
import re
import time
from dataclasses import dataclass
from typing import Any, Iterable
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from bs4 import BeautifulSoup, Tag


LOGIN_HOSTS = {"passport.weibo.com"}
DEFAULT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


class LoginRequired(RuntimeError):
    pass


class ParseError(RuntimeError):
    pass


@dataclass(frozen=True)
class Post:
    mid: str
    uid: str | None
    username: str | None
    created_at_text: str | None
    body: str
    url: str | None


def cookie_from_env() -> str:
    cookie = os.environ.get("WEIBO_COOKIE", "").strip()
    if not cookie:
        raise LoginRequired("WEIBO_COOKIE is missing")
    if "=" not in cookie:
        raise LoginRequired("WEIBO_COOKIE is malformed")
    return cookie


def client(cookie: str | None = None) -> httpx.Client:
    headers = {
        "User-Agent": DEFAULT_UA,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    }
    if cookie:
        headers["Cookie"] = cookie
    return httpx.Client(headers=headers, follow_redirects=True, timeout=30)


def assert_authenticated(response: httpx.Response) -> None:
    host = (response.url.host or "").lower()
    body_head = response.text[:5000]
    if host in LOGIN_HOSTS or "/visitor/visitor" in str(response.url):
        raise LoginRequired("Weibo redirected to the visitor/login system")
    if "passport.weibo.com/sso/signin" in body_head:
        raise LoginRequired("Weibo returned the login page")


def search_url(topic: str, page: int) -> str:
    return "https://s.weibo.com/weibo?" + urlencode({"q": topic, "page": page})


def ai_search_url(topic: str) -> str:
    return "https://s.weibo.com/aisearch?" + urlencode(
        {"q": topic, "Refer": "weibo_aisearch", "t": "31"}
    )


def _clean_text(node: Tag) -> str:
    text = node.get_text("\n", strip=True)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(text)).strip()


def parse_search_page(source: str) -> list[Post]:
    soup = BeautifulSoup(source, "html.parser")
    posts: list[Post] = []
    for card in soup.select("div.card-wrap[mid]"):
        mid = (card.get("mid") or "").strip()
        if not mid:
            continue

        content = card.select_one('[node-type="feed_list_content_full"]')
        if content is None:
            content = card.select_one('[node-type="feed_list_content"]')
        if content is None:
            continue

        author = card.select_one("a.name[nick-name]")
        uid = None
        if author and author.get("href"):
            match = re.search(r"weibo\.com/(?:u/)?(\d+)", str(author.get("href")))
            uid = match.group(1) if match else None

        permalink = None
        time_link = card.select_one("div.from a[href*='weibo.com']")
        if time_link and time_link.get("href"):
            permalink = canonical_https(str(time_link.get("href")))

        posts.append(
            Post(
                mid=mid,
                uid=uid,
                username=author.get_text(strip=True) if author else None,
                created_at_text=time_link.get_text(" ", strip=True) if time_link else None,
                body=_clean_text(content),
                url=permalink,
            )
        )
    if not posts:
        raise ParseError("No post cards were found")
    return posts


def collect_search_pages(
    http: httpx.Client,
    topic: str,
    pages: int = 10,
    delay_range: tuple[float, float] = (3.0, 8.0),
) -> list[list[Post]]:
    result: list[list[Post]] = []
    seen: set[str] = set()
    for page in range(1, pages + 1):
        response = http.get(
            search_url(topic, page),
            headers={"Referer": "https://s.weibo.com/"},
        )
        response.raise_for_status()
        assert_authenticated(response)
        parsed = parse_search_page(response.text)
        result.append([post for post in parsed if not (post.mid in seen or seen.add(post.mid))])
        if page != pages:
            time.sleep(random.uniform(*delay_range))
    return result


def canonical_https(value: str) -> str | None:
    if value.startswith("//"):
        return "https:" + value.split("?", 1)[0]
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urlparse(value)
        return parsed._replace(scheme="https", query="", fragment="").geturl()
    if value.startswith("sinaweibo://"):
        query = parse_qs(urlparse(value).query)
        mid = (query.get("mblogid") or query.get("mix_mid") or query.get("mid") or [None])[0]
        return f"https://m.weibo.cn/detail/{mid}" if mid else None
    return None


def normalize_ai_payload(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("msg") or "")
    refusal = "抱歉，这个问题我暂时无法回答" in message
    links: list[str] = []
    for item in payload.get("link_list") or []:
        normalized = canonical_https(str(item))
        if normalized and normalized not in links:
            links.append(normalized)
    return {
        "query": payload.get("query"),
        "status": payload.get("status"),
        "version": payload.get("version"),
        "initial_version": payload.get("initial_version"),
        "unify_md5": payload.get("unify_md5"),
        "page_id": payload.get("page_id"),
        "refusal": refusal,
        "message": message,
        "links": links,
    }


def unique_posts(pages: Iterable[Iterable[Post]]) -> list[Post]:
    result: list[Post] = []
    seen: set[str] = set()
    for page in pages:
        for post in page:
            if post.mid not in seen:
                seen.add(post.mid)
                result.append(post)
    return result

