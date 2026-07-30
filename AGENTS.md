# Financial Knowledge Agent Notes

本项目是个人 AI 投研工作台，负责展示和管理报告、持仓、自选标的、自动化任务和决策记录。云端应用本身不依赖 Codex skills；Codex skills 是本机研究生产工具。

## 迭代标准

- 本项目是个人小型项目。除非用户明确要求兼容历史部署或外部使用者，不要为了迁移兼容长期保留无用代码、兼容 wrapper 或双路径实现；完成迁移后应及时删除旧路径，避免项目逐渐腐化成难维护的屎山。
- 架构方向的清理不能只以“也能工作”为目标；应追求清晰、优雅、可扩展的模块边界和数据流。遇到能跑但结构含混的实现，优先给出并落地更干净的方案。
- 每次代码迭代完成并通过必要检查后，自动完整重启本地项目：停止该项目已有的开发进程，从项目根目录运行 `npm run dev`，确保 API、Worker 和前端同时启动。重启后至少验证 `5173`、`8000` 端口、`/api/v1/auth/session` 和 `/api/v1/status`，不要留下仅前端运行的状态。
- 每次迭代完成后运行 `codegraph sync`，保持 CodeGraph 状态同步。

## 推荐使用的全局 Skills

重新打开本项目后，优先使用这些全局 Codex skills：

- `investment-research`：产业链、个股、ETF/基金、候选标的和投研报告生成。
- `hithink-market-query`：股票、ETF、指数行情查询。需要本机环境变量 `IWENCAI_API_KEY`。
- `hithink-fund-query`：基金业绩、持仓、经理、评级等查询。需要本机环境变量 `IWENCAI_API_KEY`。

这些 skills 位于本机全局目录 `~/.codex/skills/`，不要复制到公开仓库，除非先做授权和脱敏确认。

## 报告入库

不要自动扫描普通聊天内容入库。只有用户明确要求“把报告放到页面/知识库/看板”时，才使用显式导入入口。

本地导入：

```bash
npm run report:import -- report.json
```

云端导入：

```bash
FINANCE_KNOWLEDGE_BASE_URL=https://your-domain.example \
FINANCE_KNOWLEDGE_IMPORT_TOKEN=... \
npm run report:import -- report.json
```

Codex 对话生成的报告默认使用：

```json
{
  "source": "chat",
  "origin": "manual"
}
```

自动化任务生成的报告才使用 `origin: "automation"`。

## 数据边界

- `data/` 是运行数据目录，只提交 `data/.gitkeep`。
- 不提交 `.env`、API key、cookie、token、个人持仓、数据库、报告 HTML、日志和本地数据源。
- 云端跨设备同步依赖同一个部署实例和持久化磁盘，不依赖 Git 同步 `data/`。

## 长任务

- 日更、数据源刷新和回补任务必须先写运行台账，再与 Procrastinate Job 同事务入队。
- `automation_runs` 记录业务编排，`source_sync_runs` 记录来源能力子运行；页面不得依赖文本日志推断任务状态。
- HTTP 触发长任务返回 `202 + run_id`，Worker 分步骤更新结构化状态。

## 证券身份

- Instrument 稳定身份是 `(exchange, asset_class, canonical_symbol)`。
- 上游身份只写 `instrument_provider_refs`；禁止把 Provider key 重新塞回 Instrument JSONB。
- 页面搜索候选必须先经 Catalog 签名 token resolve，客户端不得把 secid 当最终证券身份。

## 部署

推荐 Docker Compose 单机部署：

```bash
cp .env.example .env
docker compose up -d --build
```

生产环境必须配置登录密码、会话密钥和导入 token。
