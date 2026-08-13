from datetime import datetime
from zoneinfo import ZoneInfo

from weibo_hot_hub.storage import save_post_pages, save_topic_bundle
from weibo_hot_hub.topic import TopicBundle
from weibo_hot_hub.weibo import Post


CAPTURED = datetime(2026, 8, 12, 20, 0, tzinfo=ZoneInfo("Asia/Shanghai"))


def test_topic_hour_is_idempotent(tmp_path) -> None:
    bundle = TopicBundle(
        "topic-id",
        "标题",
        {"topic_id": "topic-id", "title": "标题"},
        {"captured_at": CAPTURED.isoformat(), "value": 1},
        {"captured_at": CAPTURED.isoformat(), "1h": {}, "24h": {}},
    )
    save_topic_bundle(tmp_path, bundle, CAPTURED, query="#原始查询#")
    save_topic_bundle(tmp_path, bundle, CAPTURED)
    trend = next(tmp_path.glob("topics/topic-id/trends/**/*.jsonl"))
    assert len(trend.read_text(encoding="utf-8").splitlines()) == 1
    meta = next(tmp_path.glob("topics/topic-id/meta.json"))
    assert '"query": "#原始查询#"' in meta.read_text(encoding="utf-8")


def test_post_objects_are_not_duplicated(tmp_path) -> None:
    post = Post("1", "2", "用户", "今天", "正文", "https://m.weibo.cn/detail/1")
    save_post_pages(tmp_path, "topic-id", CAPTURED, [[post], [post]])
    objects = list(tmp_path.glob("topics/topic-id/posts/objects/*.json"))
    assert len(objects) == 1
