from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from .weibo import _sleep_with_jitter


TOPIC_HOST = "https://m.s.weibo.com"


class TopicFetchError(RuntimeError):
    pass


@dataclass(frozen=True)
class TopicBundle:
    topic_id: str
    title: str
    meta: dict[str, Any]
    snapshot: dict[str, Any]
    trends: dict[str, Any]


def _payload(response: httpx.Response) -> dict[str, Any]:
    response.raise_for_status()
    data = response.json()
    if str(data.get("code")) != "100000" or not isinstance(data.get("data"), dict):
        raise TopicFetchError(
            f"Topic API error: code={data.get('code')} msg={data.get('msg')}"
        )
    return data["data"]


def _topic_with_hashes(topic: str) -> str:
    value = topic.strip()
    if not value.startswith("#"):
        value = "#" + value
    if not value.endswith("#"):
        value += "#"
    return value


def _topic_without_hashes(topic: str) -> str:
    return _topic_with_hashes(topic).strip("#")


def topic_referer(topic: str) -> str:
    return f"{TOPIC_HOST}/vtopic/detail_new?q={quote(_topic_with_hashes(topic))}"


def topic_client() -> httpx.Client:
    return httpx.Client(
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json,text/plain,*/*",
        },
        timeout=30,
        follow_redirects=True,
    )


def _get(
    http: httpx.Client, path: str, topic: str, params: dict[str, str]
) -> dict[str, Any]:
    response = http.get(
        TOPIC_HOST + path,
        params=params,
        headers={"Referer": topic_referer(topic)},
    )
    return _payload(response)


def fetch_topic_bundle(
    http: httpx.Client, topic: str, captured_at: datetime
) -> TopicBundle:
    query = _topic_with_hashes(topic)
    detail = _get(
        http,
        "/ajax_topic/detail",
        topic,
        {"q": query, "show_rank_info": "1"},
    )
    # The 6m/1h trend endpoint overlaps with the 24h window and was dropped to
    # keep the per-topic request count low; a short jittered pause keeps the
    # three remaining requests from arriving as an identical burst.
    _sleep_with_jitter(0.4, 0.2)
    trend_24h = _get(
        http,
        "/ajax_topic/trend",
        topic,
        {"q": query, "version": "v1", "time": "24h"},
    )
    _sleep_with_jitter(0.4, 0.2)
    level = _get(
        http,
        "/ajax_topic/level",
        topic,
        {"q": _topic_without_hashes(topic)},
    )
    return normalize_topic_bundle(detail, {}, trend_24h, level, captured_at)


def fetch_topic_trends(
    http: httpx.Client,
    topic: str,
    topic_id: str,
    captured_at: datetime,
) -> dict[str, Any]:
    """Fetch only the 24-hour curves needed to extend an off-list archive."""
    query = _topic_with_hashes(topic)
    trend_24h = _get(
        http,
        "/ajax_topic/trend",
        topic,
        {"q": query, "version": "v1", "time": "24h"},
    )
    return {
        "captured_at": captured_at.isoformat(),
        "topic_id": topic_id,
        "1h": {},
        "24h": _absolute_points(trend_24h, captured_at),
    }


def _overview_group(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    return {
        "read": source.get("r"),
        "mention": source.get("m"),
        "interaction": source.get("interact"),
        "original": source.get("ori_m"),
    }


def _contributors(base_info: dict[str, Any]) -> list[dict[str, Any]]:
    users = {
        str(item.get("idstr") or item.get("id")): item
        for item in base_info.get("lists_users") or []
        if item.get("idstr") or item.get("id")
    }
    result: list[dict[str, Any]] = []
    for rank, item in enumerate(base_info.get("lists") or [], start=1):
        uid = str(item.get("uid") or "")
        user = users.get(uid, {})
        result.append(
            {
                "rank": rank,
                "uid": uid,
                "username": user.get("screen_name"),
                "contribution": item.get("contribution"),
                "profile_url": f"https://weibo.com/u/{uid}" if uid else None,
                "verified": user.get("verified"),
                "verified_type": user.get("verified_type"),
            }
        )
    return result


def _host(value: Any) -> dict[str, Any] | None:
    source = value if isinstance(value, dict) else {}
    if not source:
        return None
    return {
        key: source.get(key)
        for key in ("uid", "screen_name", "claim_time", "created_at", "status", "is_claim")
        if key in source
    }


def _media_info(value: Any) -> dict[str, Any] | None:
    source = value if isinstance(value, dict) else {}
    if not source:
        return None
    users: list[dict[str, Any]] = []
    for item in source.get("users") or []:
        if not isinstance(item, dict):
            continue
        users.append(
            {
                key: item.get(key)
                for key in ("id", "idstr", "screen_name", "verified", "verified_type")
                if key in item
            }
        )
    return {
        "show_str": source.get("show_str"),
        "scheme_url": source.get("scheme_url"),
        "users": users,
    }


def _absolute_points(
    trend: dict[str, Any], captured_at: datetime
) -> dict[str, list[dict[str, Any]]]:
    output: dict[str, list[dict[str, Any]]] = {}
    mapping = {
        "read": "read",
        "mention": "me",
        "interaction": "partake",
        "original": "ori",
    }
    for target, source in mapping.items():
        points: list[dict[str, Any]] = []
        previous: datetime | None = None
        for item in trend.get(source) or []:
            clock = str(item.get("time") or "")
            try:
                hour, minute = [int(part) for part in clock.split(":", 1)]
                moment = captured_at.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if moment > captured_at + timedelta(minutes=5):
                    moment -= timedelta(days=1)
                if previous and moment < previous:
                    moment += timedelta(days=1)
                previous = moment
                at = moment.isoformat()
            except (TypeError, ValueError):
                at = None
            points.append({"at": at, "label": clock, "value": item.get("value")})
        output[target] = points
    return output


def normalize_topic_bundle(
    detail: dict[str, Any],
    trend_1h: dict[str, Any],
    trend_24h: dict[str, Any],
    level: dict[str, Any],
    captured_at: datetime,
) -> TopicBundle:
    base_info = detail.get("baseInfo") or {}
    obj = base_info.get("object") or {}
    base_data = detail.get("baseData") or {}
    biz = obj.get("biz") or {}
    topic_id = str(biz.get("containerid") or obj.get("id") or "")
    title = str(obj.get("display_name") or "").strip("#")
    if not topic_id or not title:
        raise TopicFetchError("Topic detail is missing a stable id or title")

    claims = detail.get("baseClaimList") or {}
    meta = {
        "topic_id": topic_id,
        "title": title,
        "summary": obj.get("summary"),
        "category": obj.get("category_str"),
        "sub_category": obj.get("sub_category_str"),
        "search_url": obj.get("url"),
        "created_at": obj.get("create_at"),
        "host": _host(claims.get("cur_claim_info")),
        "media_info": _media_info(detail.get("media_info")),
    }
    snapshot = {
        "captured_at": captured_at.isoformat(),
        "topic_id": topic_id,
        "title": title,
        "heat": level.get("level"),
        "overview": {
            "all": _overview_group(base_data.get("sum_all")),
            "24h": _overview_group(base_data.get("sum_24h")),
            "30d": _overview_group(base_data.get("sum_30d")),
        },
        "exact_counts": base_info.get("count"),
        "window_counts": {
            key: base_info.get(key)
            for key in ("24h_read", "24h_mention", "1h_mention", "1h_ori_m")
            if key in base_info
        },
        "rank_history": (base_data.get("m_rank_pos_duration") or {}).get("data") or [],
        "current_boards": base_info.get("band_info") or [],
        "contributors": _contributors(base_info),
        "contributors_scheme": base_info.get("lists_users_scheme"),
    }
    trends = {
        "captured_at": captured_at.isoformat(),
        "topic_id": topic_id,
        "1h": _absolute_points(trend_1h, captured_at),
        "24h": _absolute_points(trend_24h, captured_at),
    }
    return TopicBundle(topic_id, title, meta, snapshot, trends)
