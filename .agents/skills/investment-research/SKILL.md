---
name: investment-research
description: Chinese-first investment research workflow for source-backed industry, market, stock, ETF, and fund analysis. Use when the user asks for 投研分析, 深度调研, 产业链 or 供应链拆解, 热点扫描, A股/港股/美股方向, 个股上涨逻辑, 候选标的比较, 基金/ETF方向, Serenity式研究, 供应链卡点 or 瓶颈分析, challenge this thesis, rank candidates, or what is worth researching now. Produces research-priority rankings, evidence grades, risk and failure conditions, and next verification steps. Research support only; no trade execution.
---

# Investment Research

## Overview

Use this skill as a project-local投研分析 workflow inspired by Serenity-style supply-chain bottleneck research. Convert a broad market story into a source-backed chain of reasoning:

`market story -> system change -> value-chain layers -> scarce layers -> candidate universe -> evidence -> ranked research priorities -> failure conditions -> next checks`

Keep the answer in the user's language. Default to concise Chinese for A股、港股、基金、ETF、产业链 and policy prompts.

## Request Router

Classify the user's request first:

- **Theme scan**: A market or theme such as AI半导体、算力、CPO、机器人、液冷、电力设备、创新药、低空经济、军工电子. Run the full workflow and rank产业链层级 before ranking companies.
- **Single-company challenge**: One company or ticker. Determine its exact chain position, evidence quality, missing proof, risk, and what would make the thesis weaker.
- **Candidate comparison**: Several companies, funds, or ETFs. Compare by chain position, scarce-layer closeness, evidence, valuation pressure, timing, and risk.
- **Research partner conversation**: The user wants to think through an idea. Ask one focused question at a time and push from narrative to evidence.
- **Local report generation**: The user wants to落盘、生成报告、进入本项目看板. Use the project integration notes below.

## Default Workflow

1. **Set scope**: infer market, theme, time window, and output format. For "现在/近期/最新", treat the default window as 3-12 months and use live/current sources when available.
2. **Translate story into system change**: identify what demand or policy changed, which old design is strained, and which physical/economic constraint matters: power, bandwidth, latency, heat, yield, material purity, reliability, cycle time, packaging density, permits, grid access, or customer certification.
3. **Map value-chain layers**: end demand, system integrators, modules/subsystems, chips/devices, process/packaging/testing, equipment/metrology, materials/consumables, physical infrastructure.
4. **Rank scarce layers first**: look for low supplier count, long qualification, hard expansion, customer certification, specialized equipment, high purity, permits, lead times, capacity reservations, prepayments, or price acceptance.
5. **Build candidate universe**: cover obvious leaders and less-obvious upstream suppliers. For a broad theme, aim for 20+ candidates when tools and time allow before selecting the final 3-7.
6. **Gather and grade evidence**: use primary and strong sources first. If the evidence is thin, label the result as an initial pass and name the exact checks still needed.
7. **Rank research priorities**: separate scarce-layer priority from company priority. Explain what each final candidate constrains or sits closest to.
8. **Stress test**: state substitution routes, faster competitor expansion, weak demand, poor margins, financing, governance, geopolitics, customer loss, valuation, and the clearest fact that would make the view wrong.
9. **Give next research moves**: end with concrete source checks, metrics, customer cross-checks, capacity evidence, contract evidence, valuation comparison, and near-term events to monitor.

Read `references/deep-research-workflow.md` for a fuller checklist when the user asks for a deep scan, ranked candidates, or "最值得研究".

## Evidence Discipline

For current security-specific claims, do not rely on memory. Prefer filings, exchange documents, company announcements, annual/interim/quarterly reports, transcripts, official orders/contracts, tenders, regulatory/project approvals, patents, standards, and technical documents. Use credible media, trade publications, industry associations, and specialist analysis as support. Treat KOL posts, screenshots, forum chatter, and price spikes as leads only.

For every top-ranked candidate, include:

- what exactly it constrains or where it sits;
- at least two concrete evidence points when available;
- an evidence label: Strong, Medium, Weak, or Needs checking;
- the main missing proof;
- what would make the ranking weaker.

Read `references/evidence-and-sources.md` when source grading or market-specific source paths matter.

## Output Contract

Lead with the judgment. For theme scans, start with layer priority, then company or fund priority. Use a compact table only when it improves comparison.

Preferred Chinese shape:

```text
先排产业链层级，再排公司。我会优先看这几层：[层级1]、[层级2]、[层级3]。
原因是这些地方更接近真实扩产约束。
```

For company rankings, use fields like:

`标的 / 卡住的环节 / 产业链位置 / 排序理由 / 证据强度 / 主要风险 / 下一步核验`

When the user asks "能不能买/最值得买", answer as research priority, not a trade instruction:

```text
我会按优先研究价值排序。买卖动作由你自己决定。
```

Read `references/output-template.md` when preparing a memo, report, or reusable answer format.

## Project Integration

This workspace contains `thinking-mvp`, a local-first research dashboard and evidence pipeline.

Use it when the user asks to生成报告、落盘、进入看板、做日更 or reuse local data:

- Store structured source snippets in `thinking-mvp/data/sources/*.json` with `title`, `summary`, `observedAt`, `confidence`, and `url`.
- Use `type: industry`, `market`, `stock`, `policy`, or `custom` according to the user's topic.
- If the user wants an HTML report, run the local app workflow described in `thinking-mvp/README.md`; the report generator should not invent facts beyond collected evidence.
- Treat previous local reports as secondary context, not primary evidence, unless they include source links and dates.

## Risk Boundary

Give research support, rankings, reasoning, and uncertainty. Avoid guaranteed returns, direct buy/sell orders, position sizing, coordinated buying language, rumor-based recommendations, material non-public information, and invented prices, filings, customers, orders, contracts, or market caps.

Use strong judgments when evidence supports them:

- `我会把这一层放第一优先级。`
- `它排得更高，是因为它更靠近真实扩产约束。`
- `这个现在还只是线索，缺客户认证和收入结构证据。`
- `如果替代供应商认证速度超预期，我会降低优先级。`

## Bundled Resources

- `references/deep-research-workflow.md`: detailed workflow for deep theme scans and ranked candidates.
- `references/evidence-and-sources.md`: evidence ladder plus A股、港股、美股 and other market source paths.
- `references/output-template.md`: final answer, memo, and local report output shapes.
- `assets/thesis-template.md`: reusable structured thesis memo template.
- `assets/scorecard-template.json`: JSON input template for local scoring.
- `scripts/bottleneck_scorecard.py`: local scoring helper for candidate prioritization after evidence is gathered.

This skill is adapted for this project from the public MIT-licensed `muxuuu/serenity-skill` methodology, with project-specific defaults for Chinese投研 and the local `thinking-mvp` workflow.
