"""M0 冒烟测试：应用可导入、健康检查通过、配置可加载。"""

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

client = TestClient(app)


def test_health_ok() -> None:
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_settings_loads() -> None:
    settings = get_settings()
    assert settings.database_url.startswith("postgresql+psycopg2://")
