import json

from weibo_hot_hub.repair_posts import repair_posts
from weibo_hot_hub.weibo import Post


class FakeClient:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


def test_repair_posts_updates_failed_items(tmp_path, monkeypatch) -> None:
    run = tmp_path / "runs/2026/08/13/22.json"
    run.parent.mkdir(parents=True)
    run.write_text(
        json.dumps(
            {
                "captured_at": "2026-08-13T22:00:00+08:00",
                "selected_count": 1,
                "summary": {"posts_saved": 0},
                "topics": [
                    {
                        "topic_id": "t1",
                        "query": "#测试#",
                        "posts": "failed",
                        "posts_error": "403",
                    }
                ],
            }
        )
    )
    monkeypatch.setattr("weibo_hot_hub.repair_posts.mobile_cookie_from_env", lambda: "a=b")
    monkeypatch.setattr("weibo_hot_hub.repair_posts.mobile_client", lambda _cookie: FakeClient())
    monkeypatch.setattr("weibo_hot_hub.repair_posts.check_mobile_login", lambda _http: True)
    monkeypatch.setattr(
        "weibo_hot_hub.repair_posts.collect_mobile_search_pages",
        lambda *_args, **_kwargs: [
            [Post("1", None, None, None, "body", "https://m.weibo.cn/detail/1")]
        ],
    )

    result = repair_posts(tmp_path, "2026/08/13/22")

    assert result["summary"]["posts_saved"] == 1
    assert result["topics"][0]["posts"] == "saved"
    assert "posts_error" not in result["topics"][0]
