import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from keitaro_dashboard.store import DashboardStore, EXACT_DEPOSITS_REPORT, decision_for_offer, roi_row_key, rounded_sub5_row  # noqa: E402


SUB5 = "2505|TZ|kkid|817171078066414|YU_TZ35|1-1-2|cbo|1"
OFFER = "TZ | LeadGenerals | GSB | reg | kkid"
CANONICAL_OFFER = "TZ | LEADGENERALS | GSB"
UNMAPPED_SUB5 = "3005|ZM|kkid|1663880434840750|sms|1-1-2|cbo|1"


def test_unmapped_sub5_rows_use_exact_deposits_for_profit(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    rows = [{
        "normalized_offer": SUB5,
        "offer": SUB5,
        "acc_spend": 2.46,
        "total_spend": 2.46,
    }]
    exact_deposits = [{
        "sub_id_5": SUB5,
        "normalized_offer": "",
        "conversions": 2,
        "deposits": 2,
        "revenue": 10,
    }]

    [row] = store._format_unmapped_sub5_rows(
        rows,
        "today",
        "2026-05-25",
        "2026-05-25",
        exact_deposit_rows=exact_deposits,
    )

    assert row["deposits"] == 2
    assert row["revenue"] == 10
    assert row["total_spend"] == 2.46
    assert row["profit"] == 7.54
    assert row["roi"] == round(7.54 / 2.46, 4)

    decision = decision_for_offer(row)
    assert decision["decision"] == "hold"
    assert decision["metrics"]["profit"] == 7.54


def test_decision_holds_no_deposit_when_reg_price_is_under_target_cpa():
    decision = decision_for_offer({
        "normalized_offer": "TZ | LeadGenerals | GSB",
        "total_spend": 1.0,
        "revenue": 0,
        "profit": -1.0,
        "roi": -1.0,
        "payout": 5,
        "regs": 2,
    })

    assert decision["decision"] == "hold"
    assert decision["reason"] == "event prices are within target CPA guardrails"
    assert decision["metrics"]["target_cpa"] == round(5 / 1.6, 4)
    assert decision["metrics"]["cpr"] == 0.5
    assert decision["metrics"]["event_signals"]["reg"]["status"] == "ok"


def test_sub5_decision_uses_sibling_payout_hint_for_cheap_regs(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    tested_sub5 = "2605|TZ|kkid|817171078066414|AL_TZ3_stories|1-1-2|cbo|1"
    sibling_sub5 = "2705|TZ|kkid|817171078066414|AL_TZ3_stories|1-1-2|cbo|2"

    [row] = store._format_unmapped_sub5_rows(
        [{
            "normalized_offer": tested_sub5,
            "offer": tested_sub5,
            "acc_spend": 1.85,
            "total_spend": 1.85,
        }],
        "custom",
        "2026-06-02",
        "2026-06-02",
        exact_deposit_rows=[{
            "offer": OFFER,
            "normalized_offer": OFFER,
            "sub_id_5": sibling_sub5,
            "conversions": 1,
            "deposits": 1,
            "revenue": 5,
        }],
        tracking_rows=[{
            "sub_id_5": tested_sub5,
            "clicks": 39,
            "conversions": 3,
        }],
    )

    decision = decision_for_offer(row)

    assert row["payout"] == 5
    assert decision["decision"] == "hold"
    assert decision["reason"] == "event prices are within target CPA guardrails"
    assert decision["metrics"]["target_cpa"] == round(5 / 1.6, 4)
    assert decision["metrics"]["regs"] == 3
    assert decision["metrics"]["cpr"] == round(1.85 / 3, 4)
    assert decision["metrics"]["event_signals"]["reg"]["status"] == "ok"


def test_decision_kills_when_known_event_prices_are_above_target_cpa():
    decision = decision_for_offer({
        "normalized_offer": "TZ | LeadGenerals | GSB",
        "total_spend": 4.0,
        "revenue": 0,
        "profit": -4.0,
        "roi": -1.0,
        "payout": 5,
        "regs": 1,
    })

    assert decision["decision"] == "kill"
    assert decision["reason"] == "event prices are above target CPA guardrails"
    assert decision["metrics"]["event_signals"]["reg"]["status"] == "expensive"


def test_rounded_sub5_row_includes_event_prices():
    row = rounded_sub5_row({
        "sub5": SUB5,
        "installs": 10,
        "regs": 4,
        "deps": 2,
        "total_spend": 2,
    })

    assert row["cpi"] == 0.2
    assert row["cpr"] == 0.5
    assert row["cpd"] == 1


def test_summary_kpis_include_unmapped_sub5_spend(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    store.ingest_spend_rows([
        {
            "date": date,
            "offer_raw": SUB5,
            "normalized_offer": SUB5,
            "acc_spend": 10,
        },
        {
            "date": date,
            "offer_raw": UNMAPPED_SUB5,
            "normalized_offer": UNMAPPED_SUB5,
            "acc_spend": 30,
        },
    ])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="custom",
        date_from=date,
        date_to=date,
        report_name=EXACT_DEPOSITS_REPORT,
        rows=[{
            "offer": OFFER,
            "normalized_offer": OFFER,
            "sub_id_5": SUB5,
            "conversions": 1,
            "deposits": 1,
            "revenue": 5,
        }],
    )

    summary = store.summary({"date_from": date, "date_to": date})

    assert summary["kpis"]["total_spend"] == 40
    assert summary["kpis"]["unmapped_sub5_spend"] == 30
    assert summary["kpis"]["revenue"] == 5
    assert summary["kpis"]["profit"] == -35
    assert summary["kpis"]["roi"] == round(-35 / 40, 4)
    assert summary["kpis"]["spend_source_label"] == "FB + PWA"


def test_geo_tests_include_linked_todo_stats(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    test = store.upsert_geo_test({
        "geo": "ZM",
        "title": "Broad creative retest",
        "test_key": "ZM|broad|creative",
        "status": "running",
    })["test"]

    store.create_todo({
        "title": "Check early deposits",
        "category": "geo",
        "entity": "ZM",
        "status": "open",
        "test_id": test["id"],
        "test_key": test["test_key"],
        "test_title": test["title"],
    })
    store.create_todo({
        "title": "Write launch notes",
        "category": "geo",
        "entity": "ZM",
        "status": "done",
        "test_key": test["test_key"],
    })

    [linked] = store.list_geo_tests({"include_finished": True})["tests"]

    assert linked["todo_count"] == 2
    assert linked["active_todo_count"] == 1
    assert linked["todo_stats"]["open"] == 1
    assert linked["todo_stats"]["done"] == 1
    assert {todo["title"] for todo in linked["todos"]} == {
        "Check early deposits",
        "Write launch notes",
    }


def test_geo_overview_card_metrics_are_lifetime_without_test_double_count(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date_a = "2026-06-01"
    date_b = "2026-06-02"
    sub5_a = "0106|ZM|kkid|1234567890|tower_rush|1-1-1|cbo|1"
    sub5_b = "0206|ZM|kkid|1234567890|new_creo|1-1-1|cbo|1"

    store.ingest_spend_rows([
        {
            "date": date_a,
            "offer_raw": sub5_a,
            "normalized_offer": sub5_a,
            "acc_spend": 10,
        },
        {
            "date": date_b,
            "offer_raw": sub5_b,
            "normalized_offer": sub5_b,
            "acc_spend": 20,
        },
    ])
    for date, sub5, deposits, revenue in (
        (date_a, sub5_a, 1, 5),
        (date_b, sub5_b, 2, 10),
    ):
        store.upsert_report_rows(
            instance="default",
            timezone="Asia/Tbilisi",
            period_key="custom",
            date_from=date,
            date_to=date,
            report_name=EXACT_DEPOSITS_REPORT,
            rows=[{
                "row_date": date,
                "sub_id_5": sub5,
                "geo": "ZM",
                "conversions": deposits,
                "deposits": deposits,
                "revenue": revenue,
            }],
        )

    for title in ("ZM TOWER RUSH", "ZM NEW CREO 0306"):
        store.upsert_geo_test({
            "geo": "ZM",
            "title": title,
            "status": "running",
            "sub5_values": [sub5_b],
        })

    overview = store.geo_overview({"date_from": date_b, "date_to": date_b})
    [row] = [item for item in overview["rows"] if item["geo"] == "ZM"]
    test_metrics = [test["metrics"] for test in overview["geo_tests"] if test["geo"] == "ZM"]

    assert row["total_spend"] == 20
    assert row["revenue"] == 10
    assert row["deposits"] == 2
    assert row["lifetime_metrics"]["total_spend"] == 30
    assert row["lifetime_metrics"]["revenue"] == 15
    assert row["lifetime_metrics"]["deposits"] == 3
    assert row["lifetime_metrics"]["profit"] == -15
    assert overview["kpis"]["total_spend"] == 20
    assert overview["kpis"]["revenue"] == 10
    assert [metrics["total_spend"] for metrics in test_metrics] == [20, 20]


def test_geo_creatives_subtract_imported_creative_spend(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    store.ingest_spend_rows([{
        "date": date,
        "offer_raw": SUB5,
        "normalized_offer": SUB5,
        "acc_spend": 20,
        "pwa_spend": 3,
    }])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="custom",
        date_from=date,
        date_to=date,
        report_name="creative",
        rows=[{
            "offer": OFFER,
            "sub_id_5": SUB5,
            "sub_id_6": "YU_TZ35",
            "clicks": 100,
            "conversions": 2,
            "revenue": 50,
            "epc": 0.5,
            "cr": 0.02,
        }],
    )

    [creative] = [
        row for row in store._geo_creatives(date, date, "custom")
        if row["geo"] == "TZ" and row["creative"] == "YU_TZ35"
    ]

    assert creative["revenue"] == 50
    assert creative["acc_spend"] == 20
    assert creative["pwa_spend"] == 3
    assert creative["total_spend"] == 23
    assert creative["profit"] == 27
    assert creative["roi"] == round(27 / 23, 4)
    assert creative["cpc"] == 0.23


def test_geo_creatives_performance_score_uses_roi_not_burnout(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    push_sub5 = "0206|ZM|kkid|1234567890|push|1-1-1|cbo|1"
    weak_sub5 = "0206|ZM|kkid|1234567890|zerkalo_bab_tr_gem|1-1-1|cbo|1"
    store.ingest_spend_rows([
        {
            "date": date,
            "offer_raw": push_sub5,
            "normalized_offer": push_sub5,
            "acc_spend": 60,
        },
        {
            "date": date,
            "offer_raw": weak_sub5,
            "normalized_offer": weak_sub5,
            "acc_spend": 58,
        },
    ])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="custom",
        date_from=date,
        date_to=date,
        report_name="creative",
        rows=[
            {
                "sub_id_5": push_sub5,
                "sub_id_6": "push",
                "clicks": 820,
                "conversions": 39,
                "revenue": 100,
            },
            {
                "sub_id_5": weak_sub5,
                "sub_id_6": "zerkalo_bab_tr_gem",
                "clicks": 381,
                "conversions": 24,
                "revenue": 60,
            },
        ],
    )

    creatives = {
        row["creative"]: row
        for row in store._geo_creatives(date, date, "custom")
        if row["geo"] == "ZM"
    }

    assert creatives["push"]["burnout_score"] == 0
    assert creatives["zerkalo_bab_tr_gem"]["burnout_score"] == 0
    assert creatives["push"]["performance_score"] == 67
    assert creatives["push"]["performance_label"] == "Тащит"
    assert creatives["zerkalo_bab_tr_gem"]["performance_score"] == 3
    assert creatives["zerkalo_bab_tr_gem"]["performance_label"] == "Слабый плюс"


def test_roi_auto_row_manual_pwa_keeps_imported_acc_spend(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    store.ingest_spend_rows([{
        "date": date,
        "offer_raw": SUB5,
        "normalized_offer": SUB5,
        "acc_spend": 10,
    }])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="today",
        date_from=date,
        date_to=date,
        report_name=EXACT_DEPOSITS_REPORT,
        rows=[{
            "offer": OFFER,
            "normalized_offer": OFFER,
            "sub_id_5": SUB5,
            "conversions": 1,
            "deposits": 1,
            "revenue": 5,
        }],
    )
    store.upsert_roi_manual({
        "period_key": "today",
        "date_from": date,
        "date_to": date,
        "row_key": roi_row_key(CANONICAL_OFFER),
        "is_manual": False,
        "offer": CANONICAL_OFFER,
        "pwa_spend": 2,
    })

    table = store.roi_table({"period_key": "today", "date_from": date, "date_to": date})
    [row] = [row for row in table["rows"] if row["offer"] == CANONICAL_OFFER]

    assert row["is_edited"] is True
    assert row["auto_acc_spend"] == 10
    assert row["acc_spend"] == 10
    assert row["pwa_spend"] == 2
    assert row["total_spend"] == 12
    assert row["profit"] == -7
    assert table["kpis"]["total_spend"] == 12


def test_roi_agency_commission_is_distributed_to_offer_rows(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    store.ingest_spend_rows([{
        "date": date,
        "offer_raw": SUB5,
        "normalized_offer": SUB5,
        "acc_spend": 10,
    }])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="today",
        date_from=date,
        date_to=date,
        report_name=EXACT_DEPOSITS_REPORT,
        rows=[{
            "offer": OFFER,
            "normalized_offer": OFFER,
            "sub_id_5": SUB5,
            "conversions": 1,
            "deposits": 1,
            "revenue": 5,
        }],
    )

    table = store.roi_table({
        "period_key": "today",
        "date_from": date,
        "date_to": date,
        "agency_commission_percent": 6,
    })
    [row] = [row for row in table["rows"] if row["offer"] == CANONICAL_OFFER]

    assert not [row for row in table["rows"] if row.get("is_system")]
    assert row["acc_spend"] == 10
    assert row["agency_commission_amount"] == 0.6
    assert row["total_spend"] == 10.6
    assert row["profit"] == -5.6
    assert row["roi"] == round(-5.6 / 10.6, 4)
    assert table["agency_commission_amount"] == 0.6
    assert table["kpis"]["total_spend"] == 10.6


def test_roi_uses_exact_deposits_instead_of_orphan_offer_revenue(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    orphan_offer = "ZM | LEADGENERALS | GSB"
    store.ingest_spend_rows([{
        "date": date,
        "offer_raw": SUB5,
        "normalized_offer": SUB5,
        "acc_spend": 10,
    }])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="today",
        date_from=date,
        date_to=date,
        report_name=EXACT_DEPOSITS_REPORT,
        rows=[{
            "offer": OFFER,
            "normalized_offer": OFFER,
            "sub_id_5": SUB5,
            "conversions": 1,
            "deposits": 1,
            "revenue": 5,
        }],
    )
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="today",
        date_from=date,
        date_to=date,
        report_name="offer",
        rows=[
            {
                "offer": OFFER,
                "normalized_offer": OFFER,
                "conversions": 1,
                "revenue": 5,
            },
            {
                "offer": orphan_offer,
                "normalized_offer": orphan_offer,
                "conversions": 0,
                "deposits": 0,
                "revenue": 5,
            },
        ],
    )

    table = store.roi_table({"period_key": "today", "date_from": date, "date_to": date})

    assert [row["offer"] for row in table["rows"]] == [CANONICAL_OFFER]
    assert table["kpis"]["deposits"] == 1
    assert table["kpis"]["revenue"] == 5
    assert table["kpis"]["profit"] == -5


def test_roi_custom_range_sums_daily_deposit_snapshots(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date_a = "2026-06-01"
    date_b = "2026-06-02"
    sub5_a = "0106|TZ|kkid|817171078066414|YU_TZ35|1-1-2|cbo|1"
    sub5_b = "0206|TZ|kkid|817171078066414|YU_TZ35|1-1-2|cbo|1"

    store.ingest_spend_rows([
        {
            "date": date_a,
            "offer_raw": sub5_a,
            "normalized_offer": sub5_a,
            "acc_spend": 6,
        },
        {
            "date": date_b,
            "offer_raw": sub5_b,
            "normalized_offer": sub5_b,
            "acc_spend": 11,
        },
    ])
    for date, sub5, deposits, revenue in (
        (date_a, sub5_a, 1, 5),
        (date_b, sub5_b, 2, 10),
    ):
        store.upsert_report_rows(
            instance="default",
            timezone="Asia/Tbilisi",
            period_key="custom",
            date_from=date,
            date_to=date,
            report_name=EXACT_DEPOSITS_REPORT,
            rows=[{
                "row_date": date,
                "offer": OFFER,
                "normalized_offer": OFFER,
                "sub_id_5": sub5,
                "conversions": deposits,
                "deposits": deposits,
                "revenue": revenue,
                "snapshot_marker": "daily",
            }],
        )
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="last_3_days",
        date_from="2026-05-31",
        date_to=date_b,
        report_name=EXACT_DEPOSITS_REPORT,
        rows=[
            {
                "row_date": date_a,
                "offer": OFFER,
                "normalized_offer": OFFER,
                "sub_id_5": sub5_a,
                "conversions": 1,
                "deposits": 1,
                "revenue": 5,
                "snapshot_marker": "range",
            },
            {
                "row_date": date_b,
                "offer": OFFER,
                "normalized_offer": OFFER,
                "sub_id_5": sub5_b,
                "conversions": 2,
                "deposits": 2,
                "revenue": 10,
                "snapshot_marker": "range",
            },
        ],
    )

    table = store.roi_table({
        "date_from": date_a,
        "date_to": date_b,
    })
    [row] = [row for row in table["rows"] if row["offer"] == CANONICAL_OFFER]

    assert row["acc_spend"] == 17
    assert row["total_spend"] == 17
    assert row["deposits"] == 3
    assert row["revenue"] == 15
    assert row["profit"] == -2
    assert table["unmapped_sub5_count"] == 0
    assert table["kpis"]["acc_spend"] == 17
    assert table["kpis"]["revenue"] == 15


def test_summary_canonicalizes_operational_decisions_and_keeps_sub5_check(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    store.ingest_spend_rows([{
        "date": date,
        "offer_raw": SUB5,
        "normalized_offer": SUB5,
        "acc_spend": 2.46,
    }])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="custom",
        date_from=date,
        date_to=date,
        report_name=EXACT_DEPOSITS_REPORT,
        rows=[{
            "offer": OFFER,
            "normalized_offer": OFFER,
            "sub_id_5": SUB5,
            "conversions": 1,
            "deposits": 1,
            "revenue": 5,
        }],
    )

    summary = store.summary({"date_from": date, "date_to": date})
    decisions = [
        *summary["scale_candidates"],
        *summary["kill_candidates"],
        *summary["hold_candidates"],
    ]
    [offer_decision] = [
        row for row in decisions
        if row["entity_name"] == CANONICAL_OFFER
    ]

    assert offer_decision["decision"] == "hold"
    assert offer_decision["metrics"]["spend"] == 2.46
    assert offer_decision["metrics"]["revenue"] == 5
    assert offer_decision["metrics"]["profit"] == 2.54
    assert not [
        row for row in decisions
        if row["entity_name"] == CANONICAL_OFFER and row["decision"] == "kill"
    ]

    [sub5_decision] = [
        row for row in summary["sub5_candidates"]
        if row["entity_name"] == SUB5
    ]
    assert sub5_decision["metrics"]["spend"] == 2.46
    assert sub5_decision["metrics"]["revenue"] == 5
    assert sub5_decision["metrics"]["profit"] == 2.54


def test_campaign_split_distributes_facebook_spend_to_offer_rows(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    campaign = "ZM Split Campaign"
    offer_a = "ZM | 22BET | A"
    offer_b = "ZM | 22BET | B"

    store.replace_campaign_offer_splits(
        instance="default",
        rows=[
            {
                "campaign_id": 101,
                "campaign": campaign,
                "stream_id": 1,
                "offer_id": 11,
                "offer": offer_a,
                "normalized_offer": offer_a,
                "share": 0.7,
            },
            {
                "campaign_id": 101,
                "campaign": campaign,
                "stream_id": 1,
                "offer_id": 12,
                "offer": offer_b,
                "normalized_offer": offer_b,
                "share": 0.3,
            },
        ],
    )
    store.ingest_spend_rows([{
        "date": date,
        "offer_raw": campaign,
        "normalized_offer": campaign,
        "facebook_campaign": campaign,
        "source": "facebook_ads",
        "acc_spend": 100,
    }])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="custom",
        date_from=date,
        date_to=date,
        report_name=EXACT_DEPOSITS_REPORT,
        rows=[
            {
                "offer": f"{offer_a} | reg",
                "normalized_offer": f"{offer_a} | reg",
                "conversions": 2,
                "deposits": 2,
                "revenue": 140,
            },
            {
                "offer": f"{offer_b} | reg",
                "normalized_offer": f"{offer_b} | reg",
                "conversions": 1,
                "deposits": 1,
                "revenue": 30,
            },
        ],
    )

    summary = store.summary({"date_from": date, "date_to": date})
    top_offers = {row["normalized_offer"]: row for row in summary["top_offers"]}

    assert top_offers[offer_a]["acc_spend"] == 70
    assert top_offers[offer_a]["total_spend"] == 70
    assert top_offers[offer_a]["revenue"] == 140
    assert top_offers[offer_a]["profit"] == 70
    assert top_offers[offer_a]["roi"] == 1
    assert top_offers[offer_b]["acc_spend"] == 30
    assert top_offers[offer_b]["total_spend"] == 30
    assert top_offers[offer_b]["revenue"] == 30
    assert top_offers[offer_b]["profit"] == 0
    assert summary["kpis"]["total_spend"] == 100
    assert summary["kpis"]["revenue"] == 170
    assert summary["kpis"]["profit"] == 70

    roi = store.roi_table({"period_key": "custom", "date_from": date, "date_to": date})
    roi_rows = {row["offer"]: row for row in roi["rows"]}

    assert roi_rows[offer_a]["acc_spend"] == 70
    assert roi_rows[offer_a]["total_spend"] == 70
    assert roi_rows[offer_b]["acc_spend"] == 30
    assert roi["kpis"]["total_spend"] == 100


def test_campaign_split_prefers_offer_unique_clicks_over_configured_shares(tmp_path):
    store = DashboardStore(tmp_path / "dashboard.sqlite3")
    date = "2026-06-02"
    campaign = "ZM Fresh Offer Campaign"
    offer_a = "ZM | 22BET | OLD"
    offer_b = "ZM | 22BET | NEW"

    store.replace_campaign_offer_splits(
        instance="default",
        rows=[
            {
                "campaign_id": 102,
                "campaign": campaign,
                "stream_id": 1,
                "offer_id": 21,
                "offer": offer_a,
                "normalized_offer": offer_a,
                "share": 0.5,
            },
            {
                "campaign_id": 102,
                "campaign": campaign,
                "stream_id": 1,
                "offer_id": 22,
                "offer": offer_b,
                "normalized_offer": offer_b,
                "share": 0.5,
            },
        ],
    )
    store.ingest_spend_rows([{
        "date": date,
        "offer_raw": campaign,
        "normalized_offer": campaign,
        "facebook_campaign": campaign,
        "source": "facebook_ads",
        "acc_spend": 110,
    }])
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="custom",
        date_from=date,
        date_to=date,
        report_name="tracking_quality",
        rows=[
            {
                "campaign": campaign,
                "offer": f"{offer_a} | reg",
                "normalized_offer": f"{offer_a} | reg",
                "campaign_unique_clicks": 100,
                "clicks": 100,
            },
            {
                "campaign": campaign,
                "offer": f"{offer_b} | reg",
                "normalized_offer": f"{offer_b} | reg",
                "campaign_unique_clicks": 10,
                "clicks": 10,
            },
        ],
    )
    store.upsert_report_rows(
        instance="default",
        timezone="Asia/Tbilisi",
        period_key="custom",
        date_from=date,
        date_to=date,
        report_name=EXACT_DEPOSITS_REPORT,
        rows=[
            {
                "offer": f"{offer_a} | reg",
                "normalized_offer": f"{offer_a} | reg",
                "deposits": 1,
                "conversions": 1,
                "revenue": 120,
            },
            {
                "offer": f"{offer_b} | reg",
                "normalized_offer": f"{offer_b} | reg",
                "deposits": 1,
                "conversions": 1,
                "revenue": 20,
            },
        ],
    )

    summary = store.summary({"date_from": date, "date_to": date})
    top_offers = {row["normalized_offer"]: row for row in summary["top_offers"]}

    assert top_offers[offer_a]["acc_spend"] == 100
    assert top_offers[offer_a]["total_spend"] == 100
    assert top_offers[offer_b]["acc_spend"] == 10
    assert top_offers[offer_b]["total_spend"] == 10
    assert summary["kpis"]["total_spend"] == 110

    roi = store.roi_table({"period_key": "custom", "date_from": date, "date_to": date})
    roi_rows = {row["offer"]: row for row in roi["rows"]}

    assert roi_rows[offer_a]["acc_spend"] == 100
    assert roi_rows[offer_b]["acc_spend"] == 10
