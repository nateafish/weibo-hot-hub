from __future__ import annotations

import html
import json
import os
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable
from urllib.parse import parse_qs, parse_qsl, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup, Tag


LOGIN_HOSTS = {"passport.weibo.com"}
MOBILE_HOST = "https://m.weibo.cn"
DEFAULT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
AVATAR_BADGES = {
    "vgold": "金V", "vorange": "橙V", "vyellow": "黄V", "vred": "红V",
    "vblue": "蓝V", "vgrey": "灰V", "club": "达人", "vgirl": "微女郎", "none": "无徽标",
}


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
    account: dict[str, Any] | None = None


def _badge_number(value: Any) -> int | None:
    if type(value) is int:
        return value
    if isinstance(value, str) and re.fullmatch(r"-?[0-9]{1,6}", value):
        return int(value)
    return None


def _badge_observed_at() -> str:
    return datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")


def account_from_user(user: dict[str, Any]) -> dict[str, Any] | None:
    """Read the mobile user fields and apply the current Weibo avatar rules."""
    fields = {
        key: user[key]
        for key in ("verified", "verified_type", "verified_type_ext")
        if user.get(key) is not None
    }
    if not fields:
        return None

    kind = _badge_number(fields.get("verified_type"))
    extension = _badge_number(fields.get("verified_type_ext"))
    symbol = None
    if fields.get("verified") is True:
        if kind == 0:
            symbol = {1: "vgold", 2: "vorange"}.get(extension, "vyellow")
        elif kind is not None and 1 <= kind <= 7:
            if extension == -1:
                symbol = "vgrey"
            elif kind == 3 and extension == 53:
                symbol = "vred"
            else:
                symbol = "vblue"
    elif fields.get("verified") is False and kind is not None:
        symbol = {220: "club", 10: "vgirl"}.get(kind, "none")

    if symbol:
        fields["badge"] = AVATAR_BADGES[symbol]
    if isinstance(user.get("verified_reason"), str) and user["verified_reason"]:
        fields["verified_reason"] = user["verified_reason"]
    return {**fields, "observed_at": _badge_observed_at(), "source": "mobile_user"}


def _account_from_search_avatar(avatar: Tag, observed_at: str) -> dict[str, Any] | None:
    """Record the badge rendered in search without inferring the user's raw codes."""
    icon = avatar.select_one(".woo-avatar-icon")
    if icon is None:
        if avatar.find("img"):
            return {"badge": AVATAR_BADGES["none"], "observed_at": observed_at, "source": "search_avatar"}
        return None
    symbols = {
        str(item.get("xlink:href") or item.get("href") or "").removeprefix("#woo_svg_")
        for item in icon.select("use")
    }
    symbols.update(
        name.removeprefix("woo-icon--")
        for item in icon.select("[class]")
        for name in item.get("class", [])
        if name.startswith("woo-icon--")
    )
    for symbol, badge in AVATAR_BADGES.items():
        if symbol in symbols:
            return {"badge": badge, "observed_at": observed_at, "source": "search_avatar"}
    return None


def mobile_headers(cookie: str) -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 "
            "Mobile/15E148 Safari/604.1"
        ),
        "Cookie": cookie,
        "Origin": MOBILE_HOST,
        "Referer": MOBILE_HOST + "/",
        "Accept": "application/json, text/plain, */*",
    }


def cookie_from_env() -> str:
    cookie = os.environ.get("WEIBO_COOKIE", "").strip()
    if not cookie:
        raise LoginRequired("WEIBO_COOKIE is missing")
    if "=" not in cookie:
        raise LoginRequired("WEIBO_COOKIE is malformed")
    return cookie


def mobile_cookie_from_env() -> str:
    cookie = os.environ.get("WEIBO_MOBILE_COOKIE", "").strip()
    if not cookie:
        raise LoginRequired("WEIBO_MOBILE_COOKIE is missing")
    if "=" not in cookie:
        raise LoginRequired("WEIBO_MOBILE_COOKIE is malformed")
    return cookie


def client(cookie: str | None = None) -> httpx.Client:
    headers = {
        "User-Agent": DEFAULT_UA,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    }
    if cookie:
        headers["Cookie"] = cookie
    return httpx.Client(headers=headers, follow_redirects=True, timeout=30)


def mobile_client(cookie: str) -> httpx.Client:
    return httpx.Client(
        headers=mobile_headers(cookie), follow_redirects=True, timeout=30
    )


def assert_authenticated(response: httpx.Response) -> None:
    host = (response.url.host or "").lower()
    body_head = response.text[:5000]
    if host in LOGIN_HOSTS or "/visitor/visitor" in str(response.url):
        raise LoginRequired("Weibo redirected to the visitor/login system")
    if "passport.weibo.com/sso/signin" in body_head:
        raise LoginRequired("Weibo returned the login page")


def search_url(topic: str, page: int) -> str:
    return "https://s.weibo.com/weibo?" + urlencode({"q": topic, "page": page})


def mobile_search_params(topic: str, page: int, search_type: str = "1") -> dict[str, Any]:
    return {
        "containerid": f"100103type={search_type}&q={topic}",
        "page_type": "searchall",
        "page": page,
    }


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
    observed_at = _badge_observed_at()
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
        avatar = card.select_one(".avator") if author else None
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
                account=_account_from_search_avatar(avatar, observed_at) if avatar else None,
            )
        )
    if not posts:
        raise ParseError("No post cards were found")
    return posts


def _plain_html(value: str | None) -> str:
    if not value:
        return ""
    return _clean_text(BeautifulSoup(value, "html.parser"))


def filter_search_cards(cards: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for card in cards:
        if card.get("card_type") == 9 and isinstance(card.get("mblog"), dict):
            result.append(card)
        group = card.get("card_group")
        if isinstance(group, list):
            for child in group:
                if child.get("card_type") == 9 and isinstance(child.get("mblog"), dict):
                    result.append(child)
    return result


def post_from_mblog(mblog: dict[str, Any], *, fallback_user: dict[str, Any] | None = None) -> Post:
    mid = str(mblog.get("id") or mblog.get("mid") or "")
    if not mid:
        raise ParseError("mblog is missing id")
    user = mblog.get("user") if isinstance(mblog.get("user"), dict) else {}
    uid = str(user.get("id") or user.get("idstr") or "") or None
    return Post(
        mid=mid,
        uid=uid,
        username=str(user.get("screen_name") or "") or None,
        created_at_text=str(mblog.get("created_at") or "") or None,
        body=_plain_html(str(mblog.get("text") or "")),
        url=f"https://m.weibo.cn/detail/{mid}",
        account=account_from_user(user) or account_from_user(fallback_user or {}),
    )


def check_mobile_login(http: httpx.Client) -> bool:
    response = http.get(MOBILE_HOST + "/api/config")
    response.raise_for_status()
    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise LoginRequired("Mobile config returned non-JSON") from exc
    return bool(payload.get("ok") == 1 and payload.get("data", {}).get("login") is True)


def request_mobile_json(
    http: httpx.Client,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    attempts: int = 5,
    retry_delay: float = 3.0,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = http.get(MOBILE_HOST + path, params=params)
            response.raise_for_status()
            payload = response.json()
            if payload.get("ok") != 1:
                raise ParseError(str(payload.get("msg") or "Mobile API returned ok != 1"))
            data = payload.get("data")
            if not isinstance(data, dict):
                raise ParseError("Mobile API data is not an object")
            return data
        except (httpx.HTTPError, json.JSONDecodeError, ParseError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                _sleep_with_jitter(retry_delay, 0.5)
    raise ParseError(f"Mobile API failed after {attempts} attempts: {last_error}")


def fetch_full_mblog(http: httpx.Client, mid: str) -> dict[str, Any] | None:
    response = http.get(MOBILE_HOST + f"/detail/{mid}")
    response.raise_for_status()
    match = re.search(r"var \$render_data = (\[.*?\])\[0\]", response.text, re.DOTALL)
    if not match:
        return None
    payload = json.loads(match.group(1))
    status = payload[0].get("status") if payload else None
    return status if isinstance(status, dict) else None


def _sleep_with_jitter(delay: float, jitter: float) -> None:
    duration = max(0.0, delay + random.uniform(-jitter, jitter))
    if duration:
        time.sleep(duration)


def collect_mobile_search_pages(
    http: httpx.Client,
    topic: str,
    pages: int = 10,
    delay: float = 4.0,
    jitter: float = 1.0,
    long_text_delay: float = 2.0,
    long_text_jitter: float = 0.5,
    fetch_full_text: bool = True,
    verify_login: bool = True,
) -> list[list[Post]]:
    if verify_login and not check_mobile_login(http):
        raise LoginRequired("Mobile /api/config reports data.login != true")
    output: list[list[Post]] = []
    seen: set[str] = set()
    for page in range(1, pages + 1):
        data = request_mobile_json(
            http, "/api/container/getIndex", params=mobile_search_params(topic, page)
        )
        page_posts: list[Post] = []
        for card in filter_search_cards(data.get("cards") or []):
            mblog = card["mblog"]
            mid = str(mblog.get("id") or "")
            if not mid or mid in seen:
                continue
            fallback_user = None
            if fetch_full_text and mblog.get("isLongText") is True:
                full = fetch_full_mblog(http, mid)
                if full and str(full.get("id") or full.get("mid") or "") == mid:
                    search_user = mblog.get("user")
                    if isinstance(search_user, dict):
                        fallback_user = search_user
                    mblog = full
                _sleep_with_jitter(long_text_delay, long_text_jitter)
            seen.add(mid)
            page_posts.append(post_from_mblog(mblog, fallback_user=fallback_user))
        output.append(page_posts)
        if page != pages:
            _sleep_with_jitter(delay, jitter)
    return output


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
        value = "https:" + value
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urlparse(value)
        transient = {"refer_flag", "Refer", "t", "band_rank"}
        query = urlencode(
            [(key, item) for key, item in parse_qsl(parsed.query) if key not in transient],
            doseq=True,
        )
        return parsed._replace(scheme="https", query=query).geturl()
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
