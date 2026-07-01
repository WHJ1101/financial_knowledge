# Financial Knowledge Agent Notes

本项目是个人 AI 投研工作台，负责展示和管理报告、持仓、自选标的、自动化任务和决策记录。云端应用本身不依赖 Codex skills；Codex skills 是本机研究生产工具。

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

## 部署

推荐 Docker Compose 单机部署：

```bash
cp .env.example .env
docker compose up -d --build
```

生产环境必须配置登录密码、会话密钥和导入 token。

