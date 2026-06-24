# Thinking MVP — 投研助手

本地优先的个人投研 Dashboard，辅助投资决策。

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

## 架构

```
thinking-mvp/
├── server/              # Node.js 后端
│   ├── index.js         # HTTP server + 路由
│   ├── routes/          # API 路由模块
│   ├── services/        # SQLite、行情、调度器
│   └── templates/       # HTML 报告模板
├── src/                 # Preact 前端
│   ├── pages/           # 7 个页面组件
│   └── components/      # 通用组件
├── lib/                 # 研究 pipeline
├── data/                # 运行时数据（SQLite + 报告 HTML）
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

SQLite 数据库（`data/app.db`），支持并发读写、索引查询。首次启动后运行 `npm run migrate` 从旧 JSON 文件迁移。
