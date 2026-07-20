"""应用配置：从环境变量/.env 读取，pydantic-settings 校验。

密钥职责分离（方案 §9.8）：SESSION_SECRET / BYOK_MASTER_KEY / LANGGRAPH_AES_KEY 各司其职。
无全局 LLM_API_KEY —— 改 BYOK，各用户在设置页配置。
"""

import base64
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

    # 报告/数据源落盘目录（移植旧 DATA_DIR；报告 HTML 在 <data_dir>/reports，数据源在 <data_dir>/sources）
    data_dir: str = "../data"
    # 研究数据源在线抓取（逗号分隔，支持 {topic}/{type} 占位；空则不抓）
    data_source_urls: str = ""
    # OpenAI-compatible 自定义服务 host 白名单，逗号分隔。
    llm_allowed_hosts: str = ""
    # 日更新闻源开关（对齐旧 env）
    daily_briefing_eastmoney_disabled: bool = False

    # 部署/安全
    cookie_secure: bool = False
    allow_insecure_host: bool = False
    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://[::1]:5173",
    ]

    # 运行环境
    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def validate_runtime_settings(settings: Settings | None = None) -> None:
    """在生产进程启动时一次性拒绝弱密钥和不完整的安全配置。"""
    current = settings or get_settings()
    if current.environment.lower() != "production":
        return

    errors: list[str] = []
    if len(current.session_secret) < 32 or current.session_secret.startswith("dev-"):
        errors.append("FINANCE_KNOWLEDGE_SESSION_SECRET 至少 32 字符且不能使用开发默认值")
    if len(current.byok_master_key) < 32 or current.byok_master_key.startswith("dev-"):
        errors.append("FINANCE_KNOWLEDGE_BYOK_MASTER_KEY 至少 32 字符且不能使用开发默认值")
    if not current.superadmin_password:
        errors.append("FINANCE_KNOWLEDGE_SUPERADMIN_PASSWORD 不能为空")
    if not current.cookie_secure and not current.allow_insecure_host:
        errors.append("生产环境必须启用 FINANCE_KNOWLEDGE_COOKIE_SECURE")
    if not current.langgraph_aes_key:
        errors.append("FINANCE_KNOWLEDGE_LANGGRAPH_AES_KEY 不能为空")
    else:
        try:
            aes_key = base64.b64decode(current.langgraph_aes_key, validate=True)
        except ValueError:
            errors.append("FINANCE_KNOWLEDGE_LANGGRAPH_AES_KEY 必须是有效 base64")
        else:
            if len(aes_key) not in (16, 24, 32):
                errors.append("FINANCE_KNOWLEDGE_LANGGRAPH_AES_KEY 解码后须为 16/24/32 字节")

    if errors:
        raise RuntimeError("生产配置校验失败：" + "；".join(errors))
