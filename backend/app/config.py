"""应用配置：从环境变量/.env 读取，pydantic-settings 校验。

密钥职责分离（方案 §9.8）：SESSION_SECRET / BYOK_MASTER_KEY / LANGGRAPH_AES_KEY 各司其职。
无全局 LLM_API_KEY —— 改 BYOK，各用户在设置页配置。
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FINANCE_KNOWLEDGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 数据库：psycopg2 驱动（procrastinate 同事务 defer 要求，方案 §4.7）
    database_url: str = "postgresql+psycopg2://fk:fk@localhost:5432/financial_knowledge"

    # 密钥分离（方案 §9.8）—— 生产必须显式配置，不用默认值
    session_secret: str = "dev-session-secret-change-me"
    byok_master_key: str = "dev-byok-master-key-change-me"  # 派生 Fernet 密钥
    langgraph_aes_key: str = ""  # 16/24/32 字节原始 AES key 的 base64；空则 checkpoint 不加密（仅开发）

    # 首启/迁移初始化超管
    superadmin_username: str = "admin"
    superadmin_password: str = ""

    # 报告导入独立 token（代表超管身份，方案 §3.4）
    import_token: str = ""

    # 部署/安全
    cookie_secure: bool = False
    allow_insecure_host: bool = False
    allowed_origins: list[str] = ["http://localhost:5173"]

    # 运行环境
    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
