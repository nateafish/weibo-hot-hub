from datetime import datetime
from zoneinfo import ZoneInfo

from weibo_hot_hub.topic import normalize_topic_bundle


CAPTURED = datetime(2026, 8, 12, 20, 0, tzinfo=ZoneInfo("Asia/Shanghai"))


def test_normalize_topic_bundle() -> None:
    detail = {
        "baseInfo": {
            "object": {
                "display_name": "#测试话题#",
                "summary": "导语",
                "category_str": "社会",
                "biz": {"containerid": "100808abc"},
            },
            "count": {"read": 123},
            "lists": [{"uid": "42", "contribution": 88}],
            "lists_users": [{"idstr": "42", "screen_name": "主持人"}],
            "band_info": [{"rank": 3}],
        },
        "baseData": {
            "sum_all": {"r": "1万", "m": "20", "interact": "30", "ori_m": "4"},
            "sum_24h": {},
            "sum_30d": {},
            "m_rank_pos_duration": {"data": [{"top_pos": 1, "duration_minute": 60}]},
        },
        "baseClaimList": {"cur_claim_info": {"uid": "42"}},
    }
    trend = {
        "read": [{"time": "19:50", "value": 1}],
        "me": [{"time": "19:50", "value": 2}],
        "partake": [{"time": "19:50", "value": 3}],
        "ori": [{"time": "19:50", "value": 4}],
    }
    bundle = normalize_topic_bundle(detail, trend, trend, {"level": 99}, CAPTURED)
    assert bundle.topic_id == "100808abc"
    assert bundle.snapshot["heat"] == 99
    assert bundle.snapshot["overview"]["all"]["read"] == "1万"
    assert bundle.snapshot["contributors"][0]["profile_url"] == "https://weibo.com/u/42"
    assert bundle.trends["1h"]["original"][0]["at"] == "2026-08-12T19:50:00+08:00"

