import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from weibo_hot_hub.site_export import export_site_data


NOW = datetime(2026, 8, 12, 23, 0, tzinfo=ZoneInfo("Asia/Shanghai"))


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def hot_topic(title: str, query: str, heat: int | None, rank: int) -> dict:
    return {
        "title": title,
        "query": query,
        "heat": heat,
        "rank": rank,
        "url": f"https://s.weibo.com/weibo?q={query}",
        "label": None,
    }


def test_export_builds_daily_peak_and_links_topic(tmp_path: Path) -> None:
    data = tmp_path / "data"
    out = tmp_path / "out"
    write_json(data / "state/cookies.json", {"status": "valid"})
    write_json(
        data / "topics/t1/meta.json",
        {"topic_id": "t1", "title": "话题甲", "host": {"screen_name": "主持人"}},
    )
    write_json(
        data / "runs/2026/08/12/10.json",
        {
            "captured_at": "2026-08-12T10:00:00+08:00",
            "topics": [{"query": "#话题甲#", "topic_id": "t1"}],
        },
    )
    write_json(
        data / "hotlists/2026/08/12/10.json",
        {
            "captured_at": "2026-08-12T10:00:00+08:00",
            "topics": [
                hot_topic("置顶", "置顶", None, 1),
                hot_topic("话题甲", "#话题甲#", 100, 2),
            ],
        },
    )
    write_json(
        data / "hotlists/2026/08/12/11.json",
        {
            "captured_at": "2026-08-12T11:00:00+08:00",
            "topics": [hot_topic("话题甲", "#话题甲#", 250, 1)],
        },
    )

    manifest = export_site_data(data, out, generated_at=NOW)
    day = json.loads((out / "hotlists/2026-08-12.json").read_text())
    topics = json.loads((out / "topics/index.json").read_text())

    assert manifest["latest_hour"] == "11"
    assert day["daily"][0]["title"] == "话题甲"
    assert day["daily"][0]["peak_heat"] == 250
    assert day["daily"][0]["hours_seen"] == 2
    assert day["hours"][0]["topics"][1]["topic_id"] == "t1"
    assert topics[0]["host"] == "主持人"
    assert topics[0]["peak_heat"] == 250


def test_export_deduplicates_daily_posts_and_converts_ai(tmp_path: Path) -> None:
    data = tmp_path / "data"
    out = tmp_path / "out"
    write_json(data / "state/cookies.json", {"status": "invalid"})
    write_json(data / "topics/t1/meta.json", {"topic_id": "t1", "title": "话题"})
    write_json(
        data / "topics/t1/post-index/2026/08/12/10.json",
        {"captured_at": "2026-08-12T10:00:00+08:00", "pages": [["m1"]]},
    )
    write_json(
        data / "topics/t1/post-index/2026/08/12/11.json",
        {"captured_at": "2026-08-12T11:00:00+08:00", "pages": [["m1"]]},
    )
    write_json(
        data / "topics/t1/posts/objects/m1.json",
        {"mid": "m1", "body": "正文", "username": "作者"},
    )
    ai_path = data / "topics/t1/ai/2026/08/12/101500-abcd.md"
    ai_path.parent.mkdir(parents=True, exist_ok=True)
    ai_path.write_text(
        '---\ncaptured_at: "2026-08-12T10:15:00+08:00"\nquery: "#话题#"\n---\n\n## 智搜正文',
        encoding="utf-8",
    )

    export_site_data(data, out, generated_at=NOW)
    posts = json.loads((out / "topics/t1/posts/2026-08-12.json").read_text())
    summary = json.loads((out / "topics/t1/summary.json").read_text())
    ai_file = out / "topics/t1/ai/2026-08-12-101500-abcd.json"

    assert list(posts["objects"]) == ["m1"]
    assert sorted(posts["hours"]) == ["10", "11"]
    assert summary["ai_versions"][0]["captured_at"] == "2026-08-12T10:15:00+08:00"
    assert json.loads(ai_file.read_text())["markdown"] == "## 智搜正文"


def test_export_tolerates_empty_archive(tmp_path: Path) -> None:
    data = tmp_path / "data"
    out = tmp_path / "out"
    write_json(data / "state/cookies.json", {"status": "invalid"})
    manifest = export_site_data(data, out, generated_at=NOW)
    assert manifest["available_dates"] == []
    assert json.loads((out / "topics/index.json").read_text()) == []


def test_export_includes_ai_only_topic_without_meta(tmp_path: Path) -> None:
    data = tmp_path / "data"
    out = tmp_path / "out"
    write_json(data / "state/cookies.json", {"status": "valid"})
    ai_path = data / "topics/t-ai/ai/2026/08/12/120000-hash.md"
    ai_path.parent.mkdir(parents=True, exist_ok=True)
    ai_path.write_text(
        '---\nquery: "#只有智搜的话题#"\ncaptured_at: "2026-08-12T12:00:00+08:00"\n---\n\n正文',
        encoding="utf-8",
    )
    export_site_data(data, out, generated_at=NOW)
    topics = json.loads((out / "topics/index.json").read_text())
    assert topics[0]["topic_id"] == "t-ai"
    assert topics[0]["title"] == "只有智搜的话题"
    assert topics[0]["has_ai"] is True
