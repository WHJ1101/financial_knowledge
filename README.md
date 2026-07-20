# 投研工作台 — Financial Knowledge

小范围可信多用户的 AI 投研工作台：多角色辩论决策、行情/宏观/情绪四面证据、持仓与知识库管理。
后端 Python（FastAPI + LangGraph），前端 React + TypeScript，数据 PostgreSQL。

> 架构方案见 `.doc/投研工作台全栈重构技术方案.md`。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + TypeScript + Vite + TanStack Query |
| 后端 | FastAPI + SQLAlchemy 2.0（同步）+ psycopg2 |
| Agent | LangGraph + langchain-openai（BYOK，各用户自带 key） |
| 队列 | procrastinate（PG 任务队列 + 周期调度） |
| 数据 | PostgreSQL 16 |
| 数据源 | 东财行情/基本面/宏观、akshare 宏观（金十源） |
| 部署 | Caddy(TLS) + init-db + api + worker + postgres |

## 本地开发

```bash
# 1. 起数据库
docker compose -f docker-compose.dev.yml up -d postgres

# 2. 后端
cd backend
uv sync
cp .env.example .env          # 填 SESSION_SECRET / BYOK_MASTER_KEY / SUPERADMIN_PASSWORD 等
uv run alembic upgrade head   # 建表
uv run python -m scripts.import_sqlite   # 先 dry-run，核对快照和账本
uv run python -m scripts.import_sqlite --apply --quarantine-orphans
uv run python -m scripts.verify_migration
uv run uvicorn app.main:app --reload      # API :8000
uv run python -m app.worker               # worker（另开终端）

# 3. 前端
cd frontend
npm install
npm run dev                   # :5173，/api 代理到后端
```

访问 `http://localhost:5173`，用 `.env` 里的超管账号登录。

## 生产部署（Docker Compose）

```bash
cp backend/.env.example .env
# 编辑 .env：POSTGRES_PASSWORD / FK_DOMAIN / SESSION_SECRET / BYOK_MASTER_KEY /
#            LANGGRAPH_AES_KEY / SUPERADMIN_PASSWORD
docker compose up -d --build
```

五服务：一次性 `init-db` 完成迁移和队列表初始化，再启动 `caddy`（TLS + 静态 + 反代）、`api`、`worker`、`postgres`。
Caddy 按 `FK_DOMAIN` 自动签发 Let's Encrypt 证书；postgres 不暴露公网端口。

## 多用户与 BYOK

- **邀请码注册**：仅超管在设置生成邀请码，成员凭码注册。
- **BYOK**：每位成员可保存多个加密 LLM Profile（API Key、Endpoint、模型），并分别配置技术、基本面、宏观、情绪、多方、空方、裁判、风控八个 Agent；密钥仅掩码回显。
- **数据归属**：行情/宏观/信号公共共享；持仓/自选/辩论按用户隔离，互不可见（超管亦然）。

## 核心功能

| 页面 | 功能 |
|------|------|
| 决策辩论 | 选标的、周期与问题 → 四面分析 → 多空开篇和交叉反驳 → 裁判裁决 → 独立风控（含模型审计、证伪条件、数据缺口） |
| 投资组合 | 持仓、自选、趋势、组合分析与导出 |
| 知识库 | 共享研报 + 私有报告，标星/归档/已读（个人态） |
| 信号源 | 社群信号 + 个人确认/忽略 |
| 设置 | 多 Profile BYOK、八 Agent 模型路由、邀请码管理 |

## 数据存储

PostgreSQL 持久化在 `pgdata` 卷；报告 HTML 等运行数据在 `data/`（挂载，不提交 Git）。
`.env`、密钥、持仓、数据库、报告 HTML 均不提交仓库。
