import db from "../services/db.js";
import { getMarketData } from "../services/market-data.js";

export function getDecisions() {
  // 每天只保留最新一条（按 date 去重）
  return db.prepare(`SELECT * FROM decisions WHERE id IN (
    SELECT id FROM decisions GROUP BY date HAVING created_at = MAX(created_at)
  ) ORDER BY date DESC LIMIT 60`).all().map(formatDecision);
}

export function createDailyDecision() {
  const stocks = db.prepare("SELECT * FROM stocks").all();
  const positions = db.prepare("SELECT * FROM positions").all();
  const indices = db.prepare("SELECT * FROM market_indices").all();
  const live = getMarketData();
  const today = localDate();
  const todayReports = db.prepare("SELECT id,title,type_label FROM reports WHERE local_date=? LIMIT 8").all(today);

  const positionNames = positions.map(p => `${p.name}(${p.code})`).join("、") || "暂无持仓";
  const stockNames = stocks.map(s => `${s.name}(${s.code})`).join("、") || "暂无自选股";
  const indexSummary = indices.map(i => {
    const liveItem = live.data.find(d => i.code.includes(d.code));
    if (liveItem) return `${i.name}：${liveItem.level} (${liveItem.changePct})`;
    return `${i.name}：${i.change_pct || "待接入"}`;
  }).slice(0, 7).join("；");

  const id = `decision-${today}`;
  const guide = {
    id, date: today,
    title: `${today} 每日决策指南`,
    summary: `持仓：${positionNames}。自选：${stockNames}。`,
    action: positions.length ? "优先复核持仓风险，再决定是否新增仓位。" : "当前无持仓，优先观察市场环境和候选标的证据。",
    market: indexSummary,
    positionAdvice: positions.map(p => ({ code: p.code, name: p.name, advice: `复核：${p.reason}；风险：${p.risk}` })),
    stockAdvice: stocks.map(s => ({ code: s.code, name: s.name, advice: s.advice, risk: s.risk })),
    reports: todayReports.map(r => ({ id: r.id, title: r.title, typeLabel: r.type_label })),
    createdAt: new Date().toISOString()
  };

  // 当天已有则更新，否则插入
  const existing = db.prepare("SELECT id FROM decisions WHERE date=?").get(today);
  if (existing) {
    db.prepare(`UPDATE decisions SET title=?,summary=?,action=?,market=?,position_advice=?,stock_advice=?,reports=?,created_at=? WHERE date=?`).run(
      guide.title, guide.summary, guide.action, guide.market,
      JSON.stringify(guide.positionAdvice), JSON.stringify(guide.stockAdvice),
      JSON.stringify(guide.reports), guide.createdAt, today
    );
    guide.id = existing.id;
  } else {
    db.prepare(`INSERT INTO decisions (id,date,title,summary,action,market,position_advice,stock_advice,reports,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      guide.id, guide.date, guide.title, guide.summary, guide.action, guide.market,
      JSON.stringify(guide.positionAdvice), JSON.stringify(guide.stockAdvice),
      JSON.stringify(guide.reports), guide.createdAt
    );
  }

  appendLog("decision", `Created decision guide: ${guide.title}`, { id: guide.id });
  return guide;
}

function formatDecision(row) {
  return {
    id: row.id, date: row.date, title: row.title, summary: row.summary,
    action: row.action, market: row.market,
    positionAdvice: JSON.parse(row.position_advice || "[]"),
    stockAdvice: JSON.parse(row.stock_advice || "[]"),
    reports: JSON.parse(row.reports || "[]"),
    createdAt: row.created_at
  };
}

function appendLog(type, message, meta = {}) {
  db.prepare("INSERT INTO logs (id,type,message,meta,created_at,local_time) VALUES (?,?,?,?,?,?)").run(
    `${Date.now()}-${Math.random().toString(16).slice(2)}`, type, message,
    JSON.stringify(meta), new Date().toISOString(), localDateTime()
  );
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function localDateTime() {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}
