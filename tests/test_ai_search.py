from datetime import datetime
from zoneinfo import ZoneInfo

from weibo_hot_hub.ai_search import message_to_markdown, normalize_ai_answer
from weibo_hot_hub.storage import save_ai_answer


CAPTURED = datetime(2026, 8, 12, 20, 0, tzinfo=ZoneInfo("Asia/Shanghai"))


def test_custom_blocks_become_https_links() -> None:
    message = '''<think>hidden</think>正文
```wbCustomBlock{"type":"quoted","data":{"quote_list":[{"name":"新华社","scheme":"sinaweibo://detail?mblogid=123"}]}}```
<media-block><div data-scheme="sinaweibo://multimedia?mix_mid=456"><span class="nick">图片作者</span></div></media-block>'''
    markdown = message_to_markdown(message)
    assert "hidden" not in markdown
    assert "[新华社](https://m.weibo.cn/detail/123)" in markdown
    assert "[图片作者](https://m.weibo.cn/detail/456)" in markdown


def test_ai_answer_only_saves_when_changed(tmp_path) -> None:
    answer = normalize_ai_answer(
        {
            "query": "#测试#",
            "status": 2,
            "version": "v1",
            "unify_md5": "upstream",
            "msg": "正文",
            "link_list": ["sinaweibo://detail?mblogid=1"],
        }
    )
    first = save_ai_answer(tmp_path, "topic", CAPTURED, answer, "https://example.com")
    second = save_ai_answer(tmp_path, "topic", CAPTURED, answer, "https://example.com")
    assert first is not None and first.exists()
    assert second is None


def test_refusal_is_not_saved(tmp_path) -> None:
    answer = normalize_ai_answer(
        {"query": "#测试#", "msg": "抱歉，这个问题我暂时无法回答，换个问题试试吧"}
    )
    assert answer.refused is True
    assert save_ai_answer(tmp_path, "topic", CAPTURED, answer, "https://example.com") is None

