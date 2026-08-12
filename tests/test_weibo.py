from weibo_hot_hub.weibo import canonical_https, normalize_ai_payload, parse_search_page


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
        "https://example.com/a",
    ]

