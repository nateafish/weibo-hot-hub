import pytest

from weibo_hot_hub.weibo import (
    _sleep_with_jitter,
    canonical_https,
    account_from_user,
    filter_search_cards,
    normalize_ai_payload,
    parse_search_page,
    post_from_mblog,
)


def test_polite_sleep_uses_bounded_jitter(monkeypatch) -> None:
    durations: list[float] = []
    monkeypatch.setattr("weibo_hot_hub.weibo.random.uniform", lambda low, high: -0.5)
    monkeypatch.setattr("weibo_hot_hub.weibo.time.sleep", durations.append)

    _sleep_with_jitter(2.0, 0.5)

    assert durations == [1.5]


def test_polite_sleep_skips_non_positive_duration(monkeypatch) -> None:
    durations: list[float] = []
    monkeypatch.setattr("weibo_hot_hub.weibo.random.uniform", lambda low, high: -1.0)
    monkeypatch.setattr("weibo_hot_hub.weibo.time.sleep", durations.append)

    _sleep_with_jitter(0.0, 1.0)

    assert durations == []


def test_scheme_to_https() -> None:
    assert canonical_https("sinaweibo://detail?mblogid=5331088060977776") == (
        "https://m.weibo.cn/detail/5331088060977776"
    )
    assert canonical_https("sinaweibo://multimedia?mix_mid=5331105231145960&mix_index=0") == (
        "https://m.weibo.cn/detail/5331105231145960"
    )


def test_parse_hidden_full_text() -> None:
    html = '''
    <div class="card-wrap" mid="123">
      <a class="name" nick-name="用户" href="//weibo.com/42">用户</a>
      <div class="from"><a href="//weibo.com/42/AbCd?refer_flag=x">今天 10:00</a></div>
      <p node-type="feed_list_content">短文 展开</p>
      <p node-type="feed_list_content_full" style="display:none">这是完整正文</p>
    </div>
    '''
    post = parse_search_page(html)[0]
    assert post.mid == "123"
    assert post.uid == "42"
    assert post.body == "这是完整正文"
    assert post.url == "https://weibo.com/42/AbCd"


def test_ai_deduplicates_links_and_detects_refusal() -> None:
    payload = {
        "query": "#测试#",
        "msg": "抱歉，这个问题我暂时无法回答，换个问题试试吧",
        "link_list": [
            "sinaweibo://detail?mblogid=1",
            "sinaweibo://detail?mblogid=1",
            "https://example.com/a?tracking=1",
        ],
    }
    normalized = normalize_ai_payload(payload)
    assert normalized["refusal"] is True
    assert normalized["links"] == [
        "https://m.weibo.cn/detail/1",
        "https://example.com/a?tracking=1",
    ]


def test_filter_top_level_and_nested_mobile_cards() -> None:
    cards = [
        {"card_type": 9, "mblog": {"id": "1"}},
        {
            "card_type": 11,
            "card_group": [
                {"card_type": 9, "mblog": {"id": "2"}},
                {"card_type": 8},
            ],
        },
    ]
    assert [item["mblog"]["id"] for item in filter_search_cards(cards)] == ["1", "2"]


def test_mobile_mblog_to_post() -> None:
    post = post_from_mblog(
        {
            "id": "123",
            "created_at": "Wed Aug 12 20:00:00 +0800 2026",
            "text": "<p>正文<br>第二行</p>",
            "user": {"id": 42, "screen_name": "用户"},
        }
    )
    assert post.uid == "42"
    assert post.body == "正文\n第二行"
    assert post.url == "https://m.weibo.cn/detail/123"
    assert post.account is None


@pytest.mark.parametrize(("verified", "kind", "extension", "badge"), [
    (True, 0, 1, "金V"),
    (True, 0, "2", "橙V"),
    (True, 0, None, "黄V"),
    (True, 3, 53, "红V"),
    (True, 3, 0, "蓝V"),
    (True, 7, -1, "灰V"),
    (False, -1, None, "无徽标"),
    (False, 220, None, "达人"),
    (False, 10, None, "微女郎"),
])
def test_mobile_account_badge_preserves_observed_fields(verified, kind, extension, badge) -> None:
    account = account_from_user({"verified": verified, "verified_type": kind, "verified_type_ext": extension})
    assert account["badge"] == badge
    assert account["verified"] is verified
    assert account["verified_type"] == kind
    assert account.get("verified_type_ext") == extension
    assert account["source"] == "mobile_user"
    assert account["observed_at"].endswith("+08:00")


def test_search_avatar_records_the_rendered_badge_only() -> None:
    source = """
    <div class="card-wrap" mid="123">
      <div class="avator"><img src="avatar.jpg"><span class="woo-avatar-icon">
        <svg><use xlink:href="#woo_svg_vorange"></use></svg>
      </span></div>
      <a class="name" nick-name="用户" href="//weibo.com/42">用户</a>
      <p node-type="feed_list_content">正文</p>
    </div>
    """
    account = parse_search_page(source)[0].account
    assert account["badge"] == "橙V"
    assert account["source"] == "search_avatar"
    assert "verified_type_ext" not in account
