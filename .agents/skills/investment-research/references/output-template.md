# Output Template

Use this file when preparing final answers, structured memos, or local report content.

## Default Answer Shape

1. Lead with the answer.
2. For deep industry or technical theme scans, add a short concept primer before rankings.
3. For theme scans, rank supply-chain layers first.
4. Name the strongest candidates inside the top layers.
5. Explain evidence and uncertainty.
6. Mention popular areas that rank lower and why.
7. Say what could make the view wrong.
8. Give next checks.

Use prose for reasoning. Use one compact table for ranking or evidence comparison if useful.

## Chinese Theme Scan Opening

```text
先排产业链层级，再排公司。我会优先看三层：[层级1]、[层级2]、[层级3]。
原因是它们更接近真实扩产约束，且公开证据更容易核验。
```

## Ranking Table

```markdown
| 优先级 | 标的/方向 | 卡住的环节 | 产业链位置 | 排序理由 | 证据强度 | 主要风险 |
|---:|---|---|---|---|---|---|
| 1 |  |  |  |  | Strong/Medium/Weak/Needs checking |  |
```

## Concept Primer

Use this before rankings for deep industry reports, technical products, or unfamiliar supply chains:

```markdown
**概念地基**
- 基础概念：[这是什么，解决什么问题，核心单位/指标是什么]
- 横向对比：[和替代/相邻技术相比，优势、短板、应用边界]
- 纵向演进：[技术代际、工艺路线、成本/性能曲线、产品形态变化]
- 投资映射：[哪些上市公司真正控制该对象，哪些只是受益或蹭主题]
```

## Single Company Challenge

```markdown
**结论**
这家公司目前更像 [控制卡点/供应卡点/受益但控制力弱/主题线索]。

**为什么**
- 产业链位置：
- 支持证据：
- 缺失证据：
- 市场可能没看清的地方：

**我会降低优先级的情况**
1.
2.
3.

**下一步先查**
1.
2.
3.
```

## Fund Or ETF Direction

For funds and ETFs, avoid treating the product name as proof of exposure. Check:

- index methodology or active mandate;
- top holdings and concentration;
- exposure to the scarce layers, not only the broad theme;
- turnover and rebalance frequency;
- liquidity, premium/discount, fees, and tracking error;
- whether holdings are popular downstream names or truly close to bottlenecks.

## Local Thinking-MVP Report Shape

When feeding `thinking-mvp`, keep source items compact and dated:

```json
{
  "title": "来源标题或指标名",
  "summary": "这条证据说明什么，避免写成结论口号。",
  "observedAt": "2026-06-23T09:30:00+08:00",
  "confidence": "high|medium|low",
  "url": "https://source.example/item"
}
```

Suggested report sections:

- 一句话结论；
- 概念地基：基础概念、横向对比、纵向演进、投资映射；
- 产业链层级排序；
- 优先研究名单；
- 证据强弱；
- 低优先级但热门的方向；
- 主要风险和反证；
- 下一步核验清单。
