from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import httpx

from .topic import TopicBundle
from .ai_search import REFERENCE_CATEGORIES, AiAnswer, fetch_reference_posts, reference_list_url
from .weibo import Post


def slug_id(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-")
    return cleaned or hashlib.sha256(value.encode()).hexdigest()[:20]


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    _atomic_text(path, payload)


def _atomic_text(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    os.replace(temporary, path)


def upsert_jsonl(path: Path, key: str, record: dict[str, Any]) -> None:
    existing: list[dict[str, Any]] = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                existing.append(json.loads(line))
    replaced = False
    for index, item in enumerate(existing):
        if item.get(key) == record.get(key):
            existing[index] = record
            replaced = True
            break
    if not replaced:
        existing.append(record)
    existing.sort(key=lambda item: str(item.get(key) or ""))
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(canonical_json(item) + "\n" for item in existing)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    os.replace(temporary, path)


def save_topic_bundle(
    root: Path,
    bundle: TopicBundle,
    captured_at: datetime,
    *,
    query: str | None = None,
) -> list[Path]:
    topic_root = root / "topics" / slug_id(bundle.topic_id)
    meta_path = topic_root / "meta.json"
    old_meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    meta = {
        **bundle.meta,
        "query": query or old_meta.get("query") or f"#{bundle.title}#",
        "first_seen_at": old_meta.get("first_seen_at") or captured_at.isoformat(),
        "last_seen_at": captured_at.isoformat(),
    }
    atomic_json(meta_path, meta)

    snapshot_path = (
        topic_root
        / "snapshots"
        / captured_at.strftime("%Y")
        / captured_at.strftime("%m")
        / captured_at.strftime("%d")
        / f"{captured_at:%H}.json"
    )
    atomic_json(snapshot_path, bundle.snapshot)

    trend_path = save_topic_trends(root, bundle.topic_id, bundle.trends, captured_at)
    return [meta_path, snapshot_path, trend_path]


def save_topic_trends(
    root: Path,
    topic_id: str,
    trends: dict[str, Any],
    captured_at: datetime,
) -> Path:
    """Save a trend-only capture without marking an off-list topic as listed again."""
    topic_root = root / "topics" / slug_id(topic_id)
    trend_path = topic_root / "trends" / captured_at.strftime("%Y") / f"{captured_at:%m-%d}.jsonl"
    trend_record = {**trends, "capture_hour": captured_at.strftime("%Y-%m-%dT%H%z")}
    upsert_jsonl(trend_path, "capture_hour", trend_record)
    return trend_path


def save_post_pages(
    root: Path,
    topic_id: str,
    captured_at: datetime,
    pages: Iterable[Iterable[Post]],
) -> list[Path]:
    topic_root = root / "topics" / slug_id(topic_id)
    objects = topic_root / "posts" / "objects"
    index_pages: list[list[str]] = []
    accounts: dict[str, dict[str, Any]] = {}
    written: list[Path] = []
    for page in pages:
        mids: list[str] = []
        for post in page:
            mids.append(post.mid)
            if post.account:
                accounts.setdefault(post.mid, post.account)
            object_path = objects / f"{post.mid}.json"
            if not object_path.exists():
                record = asdict(post)
                if not post.account:
                    record.pop("account")
                atomic_json(object_path, record)
                written.append(object_path)
        index_pages.append(mids)
    index_path = (
        topic_root
        / "post-index"
        / captured_at.strftime("%Y")
        / captured_at.strftime("%m")
        / captured_at.strftime("%d")
        / f"{captured_at:%H}.json"
    )
    atomic_json(
        index_path,
        {
            "captured_at": captured_at.isoformat(),
            "topic_id": topic_id,
            "pages": index_pages,
            "unique_posts": len({mid for page in index_pages for mid in page}),
            **({"accounts": accounts} if accounts else {}),
        },
    )
    written.append(index_path)
    return written


def save_ai_answer(
    root: Path,
    topic_id: str,
    captured_at: datetime,
    answer: AiAnswer,
    source_url: str,
    *,
    reference_http: httpx.Client | None = None,
    known_posts: Iterable[Post] = (),
) -> Path | None:
    if answer.refused or not answer.markdown:
        return None
    topic_root = root / "topics" / slug_id(topic_id)
    ai_root = topic_root / "ai"
    state_path = ai_root / "state.json"
    digest = hashlib.sha256(answer.markdown.encode()).hexdigest()
    references = answer.references
    answer_revision = content_hash([digest, answer.version, answer.sources])
    revision = content_hash([
        answer_revision,
        [references.percentages, list(references.members.items())] if references else None,
    ])
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    previous_path = state.get("path")
    previous = topic_root / previous_path if previous_path else None
    if state.get("answer_sha256") == answer_revision and previous is not None and previous.is_file():
        if references is None:
            _save_answer_thinking(previous, answer)
            return None
        trace_path = previous.with_suffix(".references.json")
        existing = json.loads(trace_path.read_text(encoding="utf-8")) if trace_path.exists() else None
        if existing is None or state.get("revision_sha256") == revision:
            _save_answer_thinking(previous, answer)
            if existing is None or any(not post.get("username") for post in existing["posts"]):
                _save_answer_references(trace_path, captured_at, answer, source_url, reference_http, known_posts, existing)
            if state.get("revision_sha256") != revision:
                atomic_json(state_path, {**state, "revision_sha256": revision})
            return None

    if not state.get("revision_sha256") and not references and state.get("content_sha256") == digest and state.get("version") == answer.version:
        if answer.version and previous is not None and previous.is_file():
            _save_answer_thinking(previous, answer)
        return None
    output = (
        ai_root
        / captured_at.strftime("%Y")
        / captured_at.strftime("%m")
        / captured_at.strftime("%d")
        / f"{captured_at:%H%M%S}-{revision[:8]}.md"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    frontmatter = {
        "captured_at": captured_at.isoformat(),
        "query": answer.query,
        "source_url": source_url,
        "content_sha256": digest,
        "upstream_md5": answer.upstream_md5,
        "version": answer.version,
        "initial_version": answer.initial_version,
        "status": answer.status,
    }
    metadata = "\n".join(
        f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in frontmatter.items()
    )
    sources = ""
    if answer.sources:
        sources = "\n\n## 信源\n\n" + "\n".join(
            f"- {url}" for url in answer.sources
        )
    if references:
        _save_answer_references(output.with_suffix(".references.json"), captured_at, answer, source_url, reference_http, known_posts)
    _save_answer_thinking(output, answer)
    _atomic_text(output, f"---\n{metadata}\n---\n\n{answer.markdown}{sources}\n")
    atomic_json(
        state_path,
        {
            "captured_at": captured_at.isoformat(),
            "content_sha256": digest,
            "answer_sha256": answer_revision,
            "revision_sha256": revision,
            "upstream_md5": answer.upstream_md5,
            "version": answer.version,
            "path": str(output.relative_to(topic_root)),
        },
    )
    return output


def _save_answer_thinking(answer_path: Path, answer: AiAnswer) -> None:
    if not answer.thinking:
        return
    path = answer_path.with_suffix(".thinking.json")
    if not path.exists():
        atomic_json(path, {"answer_version": answer.version, "markdown": answer.thinking})


def _save_answer_references(
    path: Path,
    captured_at: datetime,
    answer: AiAnswer,
    source_url: str,
    http: httpx.Client | None,
    known_posts: Iterable[Post],
    existing: dict[str, Any] | None = None,
) -> None:
    refs = answer.references
    if refs is None:
        return
    prior = {item["mid"]: item for item in existing["posts"]} if existing else {}
    posts = {post.mid: post for post in known_posts if post.mid in refs.members}
    wanted = {
        mid for mid in refs.members
        if not prior.get(mid, {}).get("username") and (mid not in posts or not posts[mid].username)
    }
    if existing is None:
        wanted.update(mid for mid, post in posts.items() if not post.account)
    resolved = fetch_reference_posts(http, answer.query, wanted) if http is not None and wanted else {}

    rows = []
    for mid, category in refs.members.items():
        known = posts.get(mid)
        post = resolved.get(mid) or known
        fallback = prior.get(mid, {})
        account = fallback.get("account")
        if existing is None:
            account = (known.account if known else None) or (post.account if post else None)
        body = known.body if known and known.body else (post.body if post else "")
        rows.append({
            "mid": mid,
            "username": fallback.get("username") or (post.username if post else None) or refs.inline_names.get(mid),
            "uid": fallback.get("uid") or (post.uid if post else None),
            "url": (post.url if post else None) or fallback.get("url") or f"https://m.weibo.cn/detail/{mid}",
            "category": REFERENCE_CATEGORIES.get(category) if category else None,
            "created_at_text": fallback.get("created_at_text") or (post.created_at_text if post else None),
            "excerpt": fallback.get("excerpt") or (body[:240] if body else None),
            **({"account": account} if account else {}),
        })

    trace = {
        "answer_version": answer.version,
        "captured_at": existing["captured_at"] if existing else captured_at.isoformat(),
        "source_url": source_url,
        "reference_url": reference_list_url(answer.query),
        "reported_count": len(refs.members),
        "breakdown": [
            {"label": REFERENCE_CATEGORIES[key], "percent": percent,
             "url": reference_list_url(answer.query, category=key if key != "media" else "")}
            for key, percent in refs.percentages.items()
        ],
        "posts": rows,
    }
    if trace != existing:
        atomic_json(path, trace)
