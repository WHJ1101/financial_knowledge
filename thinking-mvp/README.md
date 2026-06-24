# Thinking MVP

Local-first research dashboard inspired by the screenshot:

- Generates industry, market, policy, and stock research reports as real `.html` files.
- Serves a small dashboard for Today, report lists, and report reading.
- Supports manual research prompts and a daily automation job.
- Tags every report by production origin: `automation` or `manual`.
- Collects evidence from local JSON files, optional HTTP sources, and previous reports.
- Can call an OpenAI-compatible LLM endpoint when configured.
- Manages watchlist stocks, manual positions, index/ETF mappings, decision guides, and automation tasks locally.
- Stores all generated artifacts under `data/`.

## Run

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

## Research Pipeline

The report generator now runs a small evidence-first pipeline:

1. Read local JSON files from `data/sources/*.json`.
2. Optionally fetch HTTP JSON sources from `DATA_SOURCE_URLS`.
3. Add related historical reports from the local vault.
4. Optionally call an OpenAI-compatible chat completions endpoint.
5. Render the final brief and evidence list into a local `.html` report.

Without LLM credentials, reports still generate as evidence-based drafts and clearly mark the LLM step as `pending`.

## Chat Reports

Conversation output is **not** automatically imported into the dashboard.

If a report produced in chat should appear in the page, say so explicitly, for example:

```text
把这篇报告加入 thinking-mvp 页面
```

Then the report should be written deliberately into `data/reports/` and registered in `data/reports.json`.
Use `origin: "manual"` and a `source` such as `chat` for these deliberately imported chat reports.

## Report Origin Tags

Every report carries two source fields:

- `origin`: product-facing filter tag. `automation` means an automation task produced it; `manual` means a human-triggered report, including page-generated reports and explicitly imported chat reports.
- `source`: technical source detail, such as `scheduled`, `daily`, `manual`, `chat`, or `seed`.

The dashboard can filter reports by origin from the top bar. The API also supports:

```bash
curl 'http://localhost:4173/api/reports?origin=automation'
curl 'http://localhost:4173/api/reports?origin=manual'
```

## Investing Features

- `股票`: manually add/remove watchlist stocks; view status, recent reports, advice, risks, and a small local sparkline placeholder.
- `持仓`: manually add/remove positions. Broker-account syncing is not implemented because it requires secure broker authorization or export-file integration.
- `指数基金`: shows major A-share, Hong Kong, and US indices plus related ETF/fund mappings. Realtime quotes are marked as pending until a market data source is connected.
- `决策`: generates a local daily decision guide from indices, watchlist stocks, positions, and today's reports.
- `任务`: manages automation tasks, including enable/pause and prompt generation from user-entered goal and implementation.

### Local data sources

Create `data/sources/` and put JSON files in it. The app accepts either a single object, an array, or an object with `items`, `records`, or `data`.

```bash
mkdir -p data/sources
cp samples/market-snapshot.example.json data/sources/market-snapshot.json
```

Useful fields per record:

```json
{
  "title": "成交额与风格轮动",
  "summary": "沪深两市成交额收缩，资金偏向算力、半导体材料和机器人产业链。",
  "observedAt": "2026-06-17T15:10:00+08:00",
  "confidence": "medium",
  "url": "https://example.com/source"
}
```

### HTTP data sources

Use comma-separated URLs. `{topic}` and `{type}` are replaced automatically.

```bash
DATA_SOURCE_URLS='https://example.com/research?topic={topic}&type={type}' npm start
```

### LLM

Any OpenAI-compatible chat completions endpoint can be used:

```bash
LLM_API_KEY='...' \
LLM_MODEL='your-model' \
npm start
```

For non-OpenAI or local endpoints:

```bash
LLM_API_URL='http://127.0.0.1:11434/v1/chat/completions' \
LLM_MODEL='your-model' \
LLM_RESPONSE_FORMAT='text' \
npm start
```

## Data Layout

```text
data/
  reports.json        # report index used by the frontend
  settings.json       # automation status and last daily run
  logs.json           # local task log
  stocks.json         # watchlist stocks
  positions.json      # manual positions
  market-indices.json # index and ETF mappings
  automation-tasks.json
  decisions.json
  sources/
    *.json            # optional evidence inputs
  reports/
    YYYY-MM-DD/
      *.html          # generated report files
```

## API

```bash
curl http://localhost:4173/api/status

curl -X POST http://localhost:4173/api/research \
  -H 'content-type: application/json' \
  -d '{"topic":"InP 产业链：光源、衬底与AI算力需求","type":"industry"}'

curl -X POST http://localhost:4173/api/jobs/daily
```
