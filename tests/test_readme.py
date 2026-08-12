from pathlib import Path

from weibo_hot_hub.readme import render_cookie_status, render_hotlist, sort_topics_by_heat


def test_cookie_status_shows_both_sessions() -> None:
    result = render_cookie_status(
        {
            "status": "invalid",
            "checked_at": "2026-08-12T21:49:10+08:00",
            "pc": {"status": "valid"},
            "mobile": {"status": "invalid"},
        }
    )
    assert "微博 Cookie**：❌ 已失效" in result
    assert "PC：✅ 有效" in result
    assert "移动端：❌ 已失效" in result
    assert "2026-08-12 21:49:10" in result


def test_hotlist_is_sorted_by_heat_with_unknown_values_last() -> None:
    topics = [
        {"rank": 1, "title": "置顶", "heat": None},
        {"rank": 2, "title": "第二", "heat": 100},
        {"rank": 3, "title": "第一", "heat": 200},
    ]
    assert [item["title"] for item in sort_topics_by_heat(topics)] == [
        "第一",
        "第二",
        "置顶",
    ]


def test_hotlist_table_has_archive_and_formatted_heat() -> None:
    result = render_hotlist(
        {
            "captured_at": "2026-08-12T21:00:00+08:00",
            "source_url": "https://s.weibo.com/top/summary",
            "topics": [
                {
                    "rank": 1,
                    "title": "测试话题",
                    "url": "https://s.weibo.com/weibo?q=test",
                    "heat": 123456,
                    "label": "新",
                }
            ],
        },
        Path("data/hotlists/2026/08/12/21.json"),
    )
    assert "今日微博热搜（2026-08-12）" in result
    assert "123,456" in result
    assert "[本次 JSON](<data/hotlists/2026/08/12/21.json>)" in result
