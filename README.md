# Financial Knowledge

个人金融投研知识库，包含 AI 驱动的投研工作流和本地研究看板。

## 项目结构

```
.agents/skills/investment-research/   # 投研分析 Skill（产业链拆解、标的排序）
thinking-mvp/                         # 本地投研看板 & 报告生成器
├── server.js                         # Node.js 服务端
├── lib/researchPipeline.js           # 研究流水线核心逻辑
├── public/                           # 前端页面
├── data/
│   ├── reports/                      # 按日期归档的 HTML 研究报告
│   ├── sources/                      # 结构化调研数据源
│   ├── stocks.json                   # 股票池
│   ├── positions.json                # 持仓跟踪
│   ├── market-indices.json           # 市场指数
│   └── settings.json                 # 应用配置
└── samples/                          # 示例数据
```

## 快速启动

```bash
cd thinking-mvp
npm start
# 浏览器打开 http://localhost:3000
```

要求 Node.js >= 20。

## 投研 Skill

`.agents/skills/investment-research/` 提供 Serenity 式供应链瓶颈研究方法论，支持：

- 产业链层级拆解与稀缺层识别
- 候选标的排序（证据分级）
- 市场/行业/个股/政策多维度报告生成
- 本地报告落盘与数据管理

## 已有报告覆盖

- AI 算力产业链（光模块、交换芯片、液冷）
- 半导体材料（锗、InP、先进封装）
- MPO/CPO 光互联
- NAND 产业链（AI 存储、企业级 SSD）
- 机器人产业链（减速器、传感器）
- A 股市场脉搏日报
- 政策日报（低空经济、算力基础设施、设备更新）

## License

Private repository.
