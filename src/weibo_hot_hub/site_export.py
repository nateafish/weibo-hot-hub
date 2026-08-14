from __future__ import annotations

import argparse
import bisect
import json
import shutil
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


def _read_json(path: Path, fallback: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return fallback


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _date_hour(path: Path, root: Path) -> tuple[str, str]:
    relative = path.relative_to(root)
    year, month, day, hour = relative.parts[-4:]
    return f"{year}-{month}-{day}", Path(hour).stem


def _number(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _sorted_by_heat(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        entries,
        key=lambda item: (
            _number(item.get("heat")) is None,
            -(_number(item.get("heat")) or 0),
            int(item.get("original_rank") or 9999),
        ),
    )


def _parse_frontmatter(source: str) -> tuple[dict[str, str], str]:
    if not source.startswith("---\n"):
        return {}, source.strip()
    end = source.find("\n---\n", 4)
    if end < 0:
        return {}, source.strip()
    metadata: dict[str, str] = {}
    for line in source[4:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip('"')
    return metadata, source[end + 5 :].strip()


def _topic_maps(data_root: Path) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    metas: dict[str, dict[str, Any]] = {}
    title_to_ids: dict[str, list[str]] = defaultdict(list)
    topics_root = data_root / "topics"
    for topic_root in sorted(path for path in topics_root.glob("*") if path.is_dir()):
        meta = _read_json(topic_root / "meta.json", {})
        topic_id = str(meta.get("topic_id") or topic_root.name)
        if not meta.get("title"):
            ai_paths = sorted((topic_root / "ai").glob("*/*/*/*.md"), reverse=True)
            if ai_paths:
                ai_meta, _ = _parse_frontmatter(ai_paths[0].read_text(encoding="utf-8"))
                query = ai_meta.get("query", "")
                meta["title"] = query.strip("#") or topic_id
        meta["topic_id"] = topic_id
        metas[topic_id] = meta
        title = str(meta.get("title") or "").strip()
        if title:
            title_to_ids[title].append(topic_id)
    unique_titles = {
        title: ids[0] for title, ids in title_to_ids.items() if len(ids) == 1
    }
    return metas, unique_titles


def _run_topic_map(data_root: Path) -> dict[tuple[str, str], str]:
    result: dict[tuple[str, str], str] = {}
    for path in sorted((data_root / "runs").glob("*/*/*/*.json")):
        run = _read_json(path, {})
        captured_at = str(run.get("captured_at") or "")
        hour_key = captured_at[:13]
        if not hour_key:
            date, hour = _date_hour(path, data_root / "runs")
            hour_key = f"{date}T{hour}"
        for topic in run.get("topics") or []:
            topic_id = topic.get("topic_id")
            query = str(topic.get("query") or "")
            if topic_id and query:
                result[(hour_key, query)] = str(topic_id)
    return result


def _export_hotlists(
    data_root: Path,
    output_root: Path,
    title_to_id: dict[str, str],
    run_topics: dict[tuple[str, str], str],
) -> tuple[list[str], str, str, dict[str, dict[str, Any]]]:
    days: dict[str, list[dict[str, Any]]] = defaultdict(list)
    topic_stats: dict[str, dict[str, Any]] = {}
    for path in sorted((data_root / "hotlists").glob("*/*/*/*.json")):
        snapshot = _read_json(path, {})
        date, hour = _date_hour(path, data_root / "hotlists")
        captured_at = str(snapshot.get("captured_at") or f"{date}T{hour}:00:00+08:00")
        entries: list[dict[str, Any]] = []
        for position, raw in enumerate(snapshot.get("topics") or [], start=1):
            title = str(raw.get("title") or "")
            query = str(raw.get("query") or "")
            topic_id = run_topics.get((captured_at[:13], query)) or title_to_id.get(title)
            entry = {
                "topic_id": topic_id,
                "title": title,
                "query": query,
                "url": raw.get("url"),
                "heat": _number(raw.get("heat")),
                "label": raw.get("label"),
                "original_rank": int(raw.get("rank") or position),
            }
            entries.append(entry)
            if topic_id:
                stats = topic_stats.setdefault(
                    topic_id,
                    {
                        "peak_heat": None,
                        "best_rank": int(entry["original_rank"]),
                        "hours_seen": 0,
                        "last_seen_at": captured_at,
                    },
                )
                heat = entry["heat"]
                if heat is not None and (stats["peak_heat"] is None or heat > stats["peak_heat"]):
                    stats["peak_heat"] = heat
                stats["best_rank"] = min(stats["best_rank"], entry["original_rank"])
                stats["hours_seen"] += 1
                stats["last_seen_at"] = max(stats["last_seen_at"], captured_at)
        days[date].append(
            {
                "hour": hour,
                "captured_at": captured_at,
                "source_url": snapshot.get("source_url"),
                "topics": entries,
            }
        )

    for date, hours in days.items():
        hours.sort(key=lambda item: item["hour"])
        daily_map: dict[str, dict[str, Any]] = {}
        for hour_snapshot in hours:
            for entry in hour_snapshot["topics"]:
                identity = str(entry.get("topic_id") or entry.get("query") or entry["title"])
                current = daily_map.get(identity)
                heat = entry.get("heat")
                if current is None:
                    current = {
                        **entry,
                        "peak_heat": heat,
                        "best_rank": entry["original_rank"],
                        "hours_seen": 0,
                        "latest_heat": heat,
                    }
                    daily_map[identity] = current
                current["hours_seen"] += 1
                current["best_rank"] = min(current["best_rank"], entry["original_rank"])
                current["latest_heat"] = heat
                current.update(
                    {
                        "title": entry["title"],
                        "url": entry["url"],
                        "label": entry["label"],
                        "topic_id": entry["topic_id"],
                    }
                )
                if heat is not None and (
                    current["peak_heat"] is None or heat > current["peak_heat"]
                ):
                    current["peak_heat"] = heat
        daily = sorted(
            daily_map.values(),
            key=lambda item: (
                item["peak_heat"] is None,
                -(item["peak_heat"] or 0),
                item["best_rank"],
            ),
        )
        _write_json(
            output_root / "hotlists" / f"{date}.json",
            {"date": date, "hours": hours, "daily": daily},
        )

    available_dates = sorted(days)
    latest_date = available_dates[-1] if available_dates else ""
    latest_hour = days[latest_date][-1]["hour"] if latest_date else ""
    return available_dates, latest_date, latest_hour, topic_stats


def _snapshot_files(topic_root: Path) -> dict[str, list[dict[str, Any]]]:
    days: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for path in sorted((topic_root / "snapshots").glob("*/*/*/*.json")):
        date, hour = _date_hour(path, topic_root / "snapshots")
        value = _read_json(path, {})
        value["hour"] = hour
        days[date].append(value)
    return days


METRIC_NAMES = ("read", "mention", "interaction", "original")


def _trend_files(topic_root: Path) -> dict[str, list[dict[str, Any]]]:
    """Per-date trend records with each capture rebuilt as the 24-hour window
    as of its capture time.

    Trend-watch captures are stored as deltas (only the points newer than the
    previous capture), so the raw records would each show just a slice. Merging
    every record captured up to that point restores the full window without
    re-storing the overlapping hours in git. All stored timestamps share the
    +08:00 zone, so ISO strings sort chronologically and bisect finds the
    24-hour cutoff in logarithmic time.
    """
    ordered: list[tuple[str, dict[str, Any]]] = []
    for path in sorted((topic_root / "trends").glob("*/*.jsonl")):
        date = f"{path.parent.name}-{path.stem}"
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            ordered.append((date, record))
    ordered.sort(key=lambda item: str(item[1].get("captured_at") or ""))

    merged: dict[str, dict[str, dict[str, Any]]] = {
        name: {} for name in METRIC_NAMES
    }
    days: dict[str, list[dict[str, Any]]] = {}
    for date, record in ordered:
        captured_at = record.get("captured_at")
        bound = None
        if captured_at:
            try:
                window_start = datetime.fromisoformat(str(captured_at)) - timedelta(
                    hours=24
                )
                bound = window_start.isoformat()
            except ValueError:
                bound = None
        for name in METRIC_NAMES:
            for point in (record.get("24h") or {}).get(name) or []:
                at = str(point.get("at") or "")
                if at:
                    merged[name][at] = point
        days.setdefault(date, []).append(
            {
                "captured_at": captured_at,
                "capture_hour": record.get("capture_hour"),
                "topic_id": record.get("topic_id"),
                "1h": {},
                "24h": {
                    name: _window_points(merged[name], bound)
                    for name in METRIC_NAMES
                },
            }
        )
    return days


def _window_points(
    points: dict[str, dict[str, Any]],
    bound: str | None,
) -> list[dict[str, Any]]:
    keys = sorted(points)
    start = bisect.bisect_left(keys, bound) if bound else 0
    return [points[key] for key in keys[start:]]


def _trend_history(days: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    by_metric: dict[str, dict[str, dict[str, Any]]] = {
        name: {} for name in METRIC_NAMES
    }
    snapshot_count = 0
    for date in sorted(days):
        records = sorted(
            days[date], key=lambda item: str(item.get("captured_at") or "")
        )
        for record in records:
            snapshot_count += 1
            series = record.get("24h") if isinstance(record.get("24h"), dict) else {}
            for name in METRIC_NAMES:
                for point in series.get(name) or []:
                    at = str(point.get("at") or "")
                    if not at or not isinstance(point.get("value"), (int, float)):
                        continue
                    # Later snapshots replace incomplete values for the same hour.
                    by_metric[name][at] = {
                        "at": at,
                        "label": str(point.get("label") or at),
                        "value": point["value"],
                    }
    metrics = {
        name: [points[at] for at in sorted(points)]
        for name, points in by_metric.items()
    }
    timestamps = sorted({point["at"] for points in metrics.values() for point in points})
    return {
        "snapshot_count": snapshot_count,
        "first_at": timestamps[0] if timestamps else None,
        "last_at": timestamps[-1] if timestamps else None,
        "metrics": metrics,
    }


def _post_files(topic_root: Path) -> dict[str, dict[str, Any]]:
    days: dict[str, dict[str, Any]] = {}
    for path in sorted((topic_root / "post-index").glob("*/*/*/*.json")):
        date, hour = _date_hour(path, topic_root / "post-index")
        index = _read_json(path, {})
        day = days.setdefault(date, {"hours": {}, "objects": {}})
        page_mids = index.get("pages") or []
        day["hours"][hour] = {
            "captured_at": index.get("captured_at"),
            "pages": page_mids,
            "unique_posts": index.get("unique_posts", 0),
        }
        for mid in {str(mid) for page in page_mids for mid in page}:
            if mid in day["objects"]:
                continue
            post = _read_json(topic_root / "posts" / "objects" / f"{mid}.json")
            if post:
                day["objects"][mid] = post
    return days


def _ai_files(topic_root: Path, output_topic_root: Path) -> list[dict[str, Any]]:
    versions: list[dict[str, Any]] = []
    for path in sorted((topic_root / "ai").glob("*/*/*/*.md"), reverse=True):
        metadata, markdown = _parse_frontmatter(path.read_text(encoding="utf-8"))
        version_id = "-".join(path.relative_to(topic_root / "ai").parts).removesuffix(".md")
        record = {
            "id": version_id,
            "captured_at": metadata.get("captured_at", ""),
            "query": metadata.get("query", ""),
            "source_url": metadata.get("source_url", ""),
            "content_sha256": metadata.get("content_sha256", ""),
        }
        versions.append(record)
        _write_json(
            output_topic_root / "ai" / f"{version_id}.json",
            {"metadata": metadata, "markdown": markdown},
        )
    versions.sort(key=lambda item: item["captured_at"], reverse=True)
    return versions


def _export_topics(
    data_root: Path,
    output_root: Path,
    metas: dict[str, dict[str, Any]],
    hotlist_stats: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    topic_index: list[dict[str, Any]] = []
    for topic_id, meta in sorted(metas.items(), key=lambda item: str(item[1].get("title") or "")):
        topic_root = data_root / "topics" / topic_id
        output_topic_root = output_root / "topics" / topic_id
        snapshots = _snapshot_files(topic_root)
        trends = _trend_files(topic_root)
        posts = _post_files(topic_root)
        versions = _ai_files(topic_root, output_topic_root)
        for date, records in snapshots.items():
            _write_json(output_topic_root / "snapshots" / f"{date}.json", records)
        for date, records in trends.items():
            _write_json(output_topic_root / "trends" / f"{date}.json", records)
        if trends:
            _write_json(
                output_topic_root / "trends" / "history.json",
                _trend_history(trends),
            )
        for date, record in posts.items():
            _write_json(output_topic_root / "posts" / f"{date}.json", record)

        latest_snapshot = None
        if snapshots:
            latest_snapshot = snapshots[sorted(snapshots)[-1]][-1]
        stats = hotlist_stats.get(topic_id, {})
        summary = {
            "topic_id": topic_id,
            "meta": meta,
            "latest_snapshot": latest_snapshot,
            "snapshot_dates": sorted(snapshots),
            "trend_dates": sorted(trends),
            "post_dates": sorted(posts),
            "ai_versions": versions,
            "stats": stats,
        }
        _write_json(output_topic_root / "summary.json", summary)
        topic_index.append(
            {
                "topic_id": topic_id,
                "title": meta.get("title") or topic_id,
                "category": meta.get("category"),
                "host": (meta.get("host") or {}).get("screen_name"),
                "first_seen_at": meta.get("first_seen_at"),
                "last_seen_at": stats.get("last_seen_at") or meta.get("last_seen_at"),
                "peak_heat": stats.get("peak_heat"),
                "best_rank": stats.get("best_rank"),
                "hours_seen": stats.get("hours_seen", 0),
                "has_posts": bool(posts),
                "has_ai": bool(versions),
            }
        )
    _write_json(output_root / "topics" / "index.json", topic_index)
    return topic_index


def export_site_data(
    data_root: Path,
    output_root: Path,
    *,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    metas, title_to_id = _topic_maps(data_root)
    run_topics = _run_topic_map(data_root)
    dates, latest_date, latest_hour, stats = _export_hotlists(
        data_root, output_root, title_to_id, run_topics
    )
    topics = _export_topics(data_root, output_root, metas, stats)
    now = generated_at or datetime.now(ZoneInfo("Asia/Shanghai")).replace(microsecond=0)
    manifest = {
        "generated_at": now.isoformat(),
        "latest_date": latest_date,
        "latest_hour": latest_hour,
        "available_dates": dates,
        "topic_count": len(topics),
        "cookie": _read_json(data_root / "state" / "cookies.json", {}),
    }
    _write_json(output_root / "manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("frontend/public/site-data"),
    )
    args = parser.parse_args()
    manifest = export_site_data(args.data_root, args.output)
    print(
        f"dates={len(manifest['available_dates'])} topics={manifest['topic_count']} "
        f"latest={manifest['latest_date']}T{manifest['latest_hour']}"
    )


if __name__ == "__main__":
    main()
