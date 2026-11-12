import json
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from weibo_hot_hub.ai_search import fetch_ai_answer, message_to_markdown, normalize_ai_answer, reference_list_url
from weibo_hot_hub.site_export import export_site_data
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


def test_thinking_comes_from_the_answer_request_and_is_exported_separately(tmp_path) -> None:
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request.method)
        assert b"cot=1" in request.content
        return httpx.Response(200, json={
            "query": "#测试#", "version": "v1", "status": 2,
            "msg": "<think>先核对时间<br>再核对引文</think>\n\n正文",
        })

    root = tmp_path / "data"
    earlier = normalize_ai_answer({"query": "#测试#", "version": "v1", "msg": "正文"})
    saved = save_ai_answer(root, "topic", CAPTURED, earlier, "https://example.com")
    assert saved is not None
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        answer = fetch_ai_answer(http, "#测试#")
        assert save_ai_answer(root, "topic", CAPTURED, answer, "https://example.com", reference_http=http) is None

    assert requests == ["POST"]
    assert "先核对时间" not in saved.read_text()
    assert answer.thinking == "先核对时间\n再核对引文"
    assert normalize_ai_answer({"msg": "<think>还在生成"}).markdown == ""

    out = tmp_path / "out"
    export_site_data(root, out, generated_at=CAPTURED)
    [version] = (out / "topics" / "topic" / "ai").glob("*.json")
    exported = json.loads(version.read_text())
    assert exported["markdown"] == "正文"
    assert exported["thinking_markdown"] == answer.thinking


def test_reference_trace_is_archived_with_the_exact_version(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("weibo_hot_hub.ai_search._sleep_with_jitter", lambda *_: None)
    topic = "#测试#"
    source_url = "https://s.weibo.com/aisearch"
    payload = {
        "msg": "同样的正文",
        "version": "v1",
        "reliable_tips": json.dumps({
            "gold_orange_v_ratio": "50%", "normal_ratio": "50%",
            "gold_orange_v_mids": ["11"], "normal_mids": ["22"],
            "ref_mid_rank": {"22": {"rank": 1}, "11": {"rank": 2}},
        }),
    }

    def card(mid: str, author: str) -> str:
        badge = '<span class="woo-avatar-icon"><svg class="woo-icon--vgold"></svg></span>' if mid == "11" else ""
        return f'''<div class="card-wrap" mid="{mid}">
          <div class="avator"><img src="avatar.jpg">{badge}</div>
          <a class="name" nick-name="{author}" href="//weibo.com/42">{author}</a>
          <div class="from"><a href="//weibo.com/42/{mid}">今天 20:00</a></div>
          <p node-type="feed_list_content">引文 {mid}</p>
        </div>'''

    requests = []
    fail_second_page = True

    def respond(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json=payload)
        page = request.url.params["page"]
        requests.append(page)
        if page == "2" and fail_second_page:
            return httpx.Response(403)
        html = card("22", "作者乙") if page == "2" else (
            card("11", "作者甲") + card("99", "其他版本的作者")
            + f'<a href="{reference_list_url(topic, page=2)}">2</a>'
        )
        return httpx.Response(200, text=f'<div id="pl_feedlist_index">{html}</div>')

    root = tmp_path / "data"
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        first = fetch_ai_answer(http, topic)
        first_path = save_ai_answer(root, "topic", CAPTURED, first, source_url, reference_http=http)
        assert first_path is not None
        assert requests == ["1", "2"]
        trace = first_path.with_suffix(".references.json")
        assert [p["username"] for p in json.loads(trace.read_text())["posts"]] == [None, "作者甲"]

        fail_second_page = False
        assert save_ai_answer(root, "topic", CAPTURED, first, source_url, reference_http=http) is None
        assert requests == ["1", "2", "1", "2"]
        assert save_ai_answer(root, "topic", CAPTURED, first, source_url, reference_http=http) is None
        assert requests == ["1", "2", "1", "2"]

        payload.pop("reliable_tips")
        without_tips = fetch_ai_answer(http, topic)
        assert save_ai_answer(root, "topic", CAPTURED, without_tips, source_url, reference_http=http) is None
        assert requests == ["1", "2", "1", "2"]

        payload["version"] = "v2"
        payload["reliable_tips"] = {"normal_ratio": "100%", "normal_mids": ["22"]}
        second = fetch_ai_answer(http, topic)
        second_path = save_ai_answer(root, "topic", CAPTURED, second, source_url, reference_http=http)
        assert second_path is not None and second_path != first_path

    out = tmp_path / "out"
    export_site_data(root, out, generated_at=CAPTURED)
    exported = out / "topics" / "topic"
    summary = json.loads((exported / "summary.json").read_text())
    assert len(summary["ai_versions"]) == 2
    assert "ai_reference_trace" not in summary
    traces = {}
    for version in summary["ai_versions"]:
        assert version["has_reference_trace"]
        answer = json.loads((exported / "ai" / f'{version["id"]}.json').read_text())
        trace_data = answer["reference_trace"]
        assert trace_data["answer_version"] == answer["metadata"]["version"]
        traces[trace_data["answer_version"]] = trace_data
    assert [(p["mid"], p["username"]) for p in traces["v1"]["posts"]] == [("22", "作者乙"), ("11", "作者甲")]
    assert "account" not in traces["v1"]["posts"][0]
    assert traces["v1"]["posts"][1]["account"]["badge"] == "金V"
    assert traces["v1"]["posts"][1]["category"] == "金橙V"
    assert [p["mid"] for p in traces["v2"]["posts"]] == ["22"]
    assert traces["v2"]["posts"][0]["account"]["badge"] == "无徽标"
    assert traces["v2"]["breakdown"][0]["percent"] == 100

