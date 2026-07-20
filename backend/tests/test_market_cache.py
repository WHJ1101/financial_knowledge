"""指数行情缓存状态区分加载、空数据、不可用和过期缓存。"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from app.services import market


def _reset_market_cache() -> None:
    market._cache.data = []
    market._cache.updated_at = None
    market._cache.attempted_at = None
    market._cache.last_error = None


@pytest.fixture(autouse=True)
def reset_market_cache() -> Iterator[None]:
    _reset_market_cache()
    yield
    _reset_market_cache()


def test_market_snapshot_starts_loading() -> None:
    assert market.get_market_snapshot()["status"] == "loading"


@pytest.mark.asyncio
async def test_market_snapshot_distinguishes_empty_success_and_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    async def empty_result() -> list[market.IndexLive]:
        return []

    monkeypatch.setattr(market, "fetch_index_list", empty_result)
    await market.refresh_market_cache()
    snapshot = market.get_market_snapshot()
    assert snapshot["status"] == "empty"
    assert snapshot["attemptedAt"] is not None

    async def failed_result() -> list[market.IndexLive]:
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(market, "fetch_index_list", failed_result)
    await market.refresh_market_cache()
    assert market.get_market_snapshot()["status"] == "unavailable"


@pytest.mark.asyncio
async def test_market_snapshot_marks_last_success_as_stale_on_refresh_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    market._cache.data = [{"code": "000001", "name": "上证指数", "level": "3000", "changePct": "1.0", "volume": None}]
    market._cache.updated_at = "2026-07-17T00:00:00+00:00"

    async def failed_result() -> list[market.IndexLive]:
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(market, "fetch_index_list", failed_result)
    await market.refresh_market_cache()
    snapshot = market.get_market_snapshot()
    assert snapshot["status"] == "stale"
    assert snapshot["indices"][0]["code"] == "000001"
