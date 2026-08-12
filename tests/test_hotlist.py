from weibo_hot_hub.hotlist import parse_hotlist


def test_parse_upstream_hotlist_shape() -> None:
    source = '''
    <table><tbody>
      <tr><td class="td-01 ranktop">1</td><td class="td-02">
        <a href="/weibo?q=%23%E6%B5%8B%E8%AF%95%E8%AF%9D%E9%A2%98%23&Refer=top">测试话题</a>
        <span>123456</span></td><td class="td-03"><i>新</i></td></tr>
      <tr><td class="td-01">2</td><td class="td-02">
        <a href="/weibo?q=%23%E7%AC%AC%E4%BA%8C%23">第二</a></td><td class="td-03"></td></tr>
    </tbody></table>
    '''
    topics = parse_hotlist(source)
    assert topics[0].rank == 1
    assert topics[0].query == "#测试话题#"
    assert topics[0].heat == 123456
    assert topics[0].label == "新"
    assert topics[1].heat is None

