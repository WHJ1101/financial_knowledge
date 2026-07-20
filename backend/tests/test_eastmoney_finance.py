"""东财财务数据备用 Provider 契约测试。"""

from app.providers.eastmoney_finance import parse_finance_snapshot


def test_parse_finance_snapshot_keeps_available_company_metrics() -> None:
    payload = {
        "result": {
            "data": [
                {
                    "SECUCODE": "301308.SZ",
                    "REPORT_DATE_NAME": "2026一季报",
                    "NOTICE_DATE": "2026-04-28 00:00:00",
                    "ROEJQ": 39.4,
                    "TOTALOPERATEREVETZ": 132.7928,
                    "PARENTNETPROFITTZ": 2644.0497,
                }
            ]
        }
    }

    snapshot = parse_finance_snapshot(payload, source_url="https://data.example/finance")

    assert snapshot.kind == "equity_fundamental"
    assert snapshot.roe == 39.4
    assert snapshot.revenue_yoy == 132.7928
    assert snapshot.profit_yoy == 2644.0497
    assert snapshot.report_period == "2026一季报"
    assert snapshot.release_at == "2026-04-28 00:00:00"
    assert snapshot.source == "eastmoney_datacenter"
    assert snapshot.data_gap is None


def test_parse_finance_snapshot_marks_empty_response() -> None:
    snapshot = parse_finance_snapshot({"result": {"data": []}})

    assert snapshot.data_gap == "财务数据接口无数据"
