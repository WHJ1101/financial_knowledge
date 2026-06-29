# Financial Knowledge — 投研助手

个人 AI 投研工作台：沉淀定时任务、网页按钮和 Codex 对话产出的投研报告，并结合行情、自选股、持仓和历史知识库做决策辅助。

## 快速启动

```bash
npm install
npm run migrate    # 首次运行：迁移 JSON 数据到 SQLite
npm run dev        # 启动后端 + Vite 开发服务器
```

生产模式：

```bash
npm run build      # 构建前端
npm start          # 启动后端（服务 dist/ 静态文件）
```

访问 `http://localhost:4173`（生产）或 `http://localhost:5173`（开发）。

## 云端部署

推荐用 Docker Compose 单机部署。代码进 Git，`data/` 作为服务器持久化目录挂载，不提交仓库。

```bash
cp .env.example .env
# 编辑 .env：设置登录密码、会话密钥、导入 token、LLM key
docker compose up -d --build
```

生产环境必须设置：

```bash
FINANCE_KNOWLEDGE_AUTH_PASSWORD=...
FINANCE_KNOWLEDGE_AUTH_SECRET=...
FINANCE_KNOWLEDGE_IMPORT_TOKEN=...
```

跨设备同步不是靠 Git，而是访问同一个云端实例。报告、持仓、任务和数据库都写入服务器 `data/`，建议定时备份该目录。

## Codex 报告入库

Codex 或其他工具不要直接自动扫描聊天内容入库。需要显式调用导入入口：

```bash
FINANCE_KNOWLEDGE_BASE_URL=https://your-domain.example \
FINANCE_KNOWLEDGE_IMPORT_TOKEN=... \
npm run report:import -- report.json
```

`report.json` 可包含：

```json
{
  "title": "半导体材料观察",
  "topic": "锗、InP 与先进封装需求",
  "type": "industry",
  "summary": "一句话摘要",
  "tags": ["产业链深度"],
  "highlights": ["核心结论 1"],
  "html": "<section><h2>正文</h2><p>...</p></section>"
}
```

导入报告默认标记为“手动产出 / 对话入库”。

## 架构

```
financial_knowledge/
├── server/              # Node.js 后端
│   ├── index.js         # HTTP server + 路由
│   ├── routes/          # API 路由模块
│   ├── services/        # SQLite、行情、调度器
│   └── templates/       # HTML 报告模板
├── src/                 # Preact 前端
│   ├── pages/           # 7 个页面组件
│   └── components/      # 通用组件
├── lib/                 # 研究 pipeline
├── data/                # 运行时数据目录，仅保留 .gitkeep
└── vite.config.js
```

## 功能（7 页）

| 页面 | 功能 |
|------|------|
| 今日 | 概览 + 行情快照 + 发起调研 + 报告列表 |
| 知识库 | 全部报告浏览/搜索/筛选/标星/归档 |
| 投资组合 | 自选股 + 持仓统一管理 |
| 行情 | 指数实时数据 + ETF 映射 |
| 决策 | 每日决策指南生成 |
| 任务 | 自动化任务管理 + 执行日志 |
| 设置 | 数据源/模型/系统配置 |

## 行情数据

自动接入东方财富免费延迟行情，交易时间内 30 秒刷新。覆盖 A 股、港股、美股主要指数。

## 研报生成

支持模型调用（需配置环境变量）和本地数据源证据采集：

```bash
LLM_API_KEY='...' LLM_MODEL='gpt-4o-mini' npm start
```

本地数据源放入 `data/sources/*.json` 即可被 pipeline 自动采集。

## 数据存储

SQLite 数据库（`data/app.db`），使用 sql.js 内存模式运行，写入时全量导出到磁盘。适合单进程单工作区场景，不支持多进程并发写入。首次启动后运行 `npm run migrate` 从旧 JSON 文件迁移。

`data/` 中的报告、数据库、持仓、日志、数据源和个人配置都属于运行数据，不应提交 Git。云端部署时用磁盘挂载和备份保证跨设备访问。
