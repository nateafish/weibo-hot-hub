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

from .topic import TopicBundle
from .ai_search import AiAnswer
from .weibo import Post


def slug_id(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-")
    return cleaned or hashlib.sha256(value.encode()).hexdigest()[:20]


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
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


def save_topic_bundle(root: Path, bundle: TopicBundle, captured_at: datetime) -> list[Path]:
    topic_root = root / "topics" / slug_id(bundle.topic_id)
    meta_path = topic_root / "meta.json"
    old_meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    meta = {
        **bundle.meta,
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

    trend_path = topic_root / "trends" / captured_at.strftime("%Y") / f"{captured_at:%m-%d}.jsonl"
    trend_record = {**bundle.trends, "capture_hour": captured_at.strftime("%Y-%m-%dT%H%z")}
    upsert_jsonl(trend_path, "capture_hour", trend_record)
    return [meta_path, snapshot_path, trend_path]


def save_post_pages(
    root: Path,
    topic_id: str,
    captured_at: datetime,
    pages: Iterable[Iterable[Post]],
) -> list[Path]:
    topic_root = root / "topics" / slug_id(topic_id)
    objects = topic_root / "posts" / "objects"
    index_pages: list[list[str]] = []
    written: list[Path] = []
    for page in pages:
        mids: list[str] = []
        for post in page:
            mids.append(post.mid)
            object_path = objects / f"{post.mid}.json"
            if not object_path.exists():
                atomic_json(object_path, asdict(post))
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
) -> Path | None:
    if answer.refused or not answer.markdown:
        return None
    topic_root = root / "topics" / slug_id(topic_id)
    ai_root = topic_root / "ai"
    state_path = ai_root / "state.json"
    digest = hashlib.sha256(answer.markdown.encode()).hexdigest()
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state.get("content_sha256") == digest:
            return None
    output = (
        ai_root
        / captured_at.strftime("%Y")
        / captured_at.strftime("%m")
        / captured_at.strftime("%d")
        / f"{captured_at:%H%M%S}-{digest[:8]}.md"
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
    output.write_text(f"---\n{metadata}\n---\n\n{answer.markdown}{sources}\n", encoding="utf-8")
    atomic_json(
        state_path,
        {
            "captured_at": captured_at.isoformat(),
            "content_sha256": digest,
            "upstream_md5": answer.upstream_md5,
            "version": answer.version,
            "path": str(output.relative_to(topic_root)),
        },
    )
    return output

