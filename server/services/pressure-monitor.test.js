import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "pressure-monitor-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;
// 失败路径测试无需真实退避，压到 1 次尝试、0 退避，避免拖慢测试。
process.env.PRESSURE_KLINE_MAX_ATTEMPTS = "1";
process.env.PRESSURE_KLINE_RETRY_MS = "0";

const { default: db } = await import("./db.js");
const { runPressureMonitor, getPressureSnapshot, allSecids, THEME_CONFIGS } = await import("./pressure-monitor.js");
const { getBars } = await import("./kline-store.js");
const { getSignals } = await import("../routes/signals.js");

// 造 160 天日线并直接写 daily_bars（绕过网络），便于确定性构造跨阈值场景。
function seedBars(secid, closeFn, volFn) {
  const stmt = db.prepare("INSERT OR REPLACE INTO daily_bars (secid,date,close,volume,updated_at) VALUES (?,?,?,?,?)");
  const now = new Date().toISOString();
  const base = new Date("2026-01-01");
  for (let i = 0; i < 160; i++) {
    const date = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    stmt.run(secid, date, closeFn(i), volFn(i), now);
  }
}

const LAST = 159;
// 带小幅波动的“平稳”序列 → 分项分位落在中段（~50，低于 70），仅在最后一天施加冲击 → 分位跳到高位。
// 这样 composite 从 <70 跳到 >=70，恰好在末尾两点之间形成“上穿 70”。
const wiggle = (i) => Math.sin(i * 1.3) * 3; // 收盘的小幅噪声
const volWiggle = (i) => 1000 + Math.round(Math.sin(i * 0.7) * 120); // 量的小幅噪声

function seedAllThemes() {
  // A股：完全平稳 → 各分项危险度恒定 → 分位恒定 → composite 平线，末尾两点相等，永不跨阈值
  seedBars("1.512480", () => 100, () => 1000);
  seedBars("1.510880", () => 100, () => 1000);
  seedBars("1.000300", () => 100, () => 1000);
  // 美股：159 天平稳带噪声，最后一天 SOXX 放量急跌 + 跑输 XLU/SPY + VIX 冲高 → 四分项齐跳 → composite 上穿 70
  seedBars("105.SOXX", (i) => (i === LAST ? 470 : 500 + wiggle(i)), (i) => (i === LAST ? 60000 : volWiggle(i)));
  seedBars("107.XLU", (i) => 100 + wiggle(i + 3), volWiggle);
  seedBars("107.SPY", (i) => 100 + wiggle(i + 7), volWiggle);
  seedBars("YAHOO.VIX", (i) => (i === LAST ? 32 : 15 + Math.sin(i) * 1.5), () => null);
  seedBars("YAHOO.VIX3M", (i) => 18 + Math.sin(i * 0.5), () => null);
}

test("allSecids covers all proxy targets deduped", () => {
  const secids = allSecids();
  assert.ok(secids.includes("1.512480"));
  assert.ok(secids.includes("105.SOXX"));
  assert.ok(secids.includes("YAHOO.VIX"));
  assert.equal(new Set(secids).size, secids.length, "no duplicates");
});

test("getPressureSnapshot returns both themes with complete shape", () => {
  seedAllThemes();
  const snap = getPressureSnapshot();
  assert.equal(snap.length, 2);
  const [a, us] = snap;
  assert.equal(a.subScores.length, 3, "A股 3 分项");
  assert.equal(us.subScores.length, 4, "美股 4 分项");
  assert.ok(us.composite >= 0 && us.composite <= 100);
});

// P3-3 + P3-4：跨阈值写信号；未跨不写
test("runPressureMonitor writes crossing signal into community_signals", async () => {
  seedAllThemes();
  // 注入 fetch，避免真实网络；返回空 klines，让 syncDailyBars 不覆盖已 seed 的数据
  const fetchImpl = async () => new Response(JSON.stringify({ data: null }), { status: 200 });
  const summary = await runPressureMonitor({ source: "test", fetchImpl });

  const usTheme = summary.themes.find((t) => t.id === "us-semi");
  assert.equal(usTheme.crossing, "up-70", "美股应上穿 70");
  assert.ok(summary.signalsWritten >= 1);

  const signals = getSignals({ source: "pressure-monitor" });
  const usSignal = signals.find((s) => s.theme === "美股半导体");
  assert.ok(usSignal, "美股压力信号已入库");
  assert.equal(usSignal.verificationStatus, "待验证");
  assert.match(usSignal.summary, /上穿 70/);

  // A股平稳未跨阈值 → 无信号
  assert.ok(!signals.find((s) => s.theme === "A股半导体"), "A股未跨阈值不写信号");

  // 快照落 settings
  const row = db.prepare("SELECT value FROM settings WHERE key='lastPressureRun'").get();
  assert.ok(row, "lastPressureRun 快照已写");
});

// P3-2：syncDailyBars 全失败时，getPressureSnapshot 仍用已有 daily_bars 现算，runPressureMonitor 不抛
test("runPressureMonitor tolerates fetch failure (does not throw)", async () => {
  seedAllThemes();
  const fetchImpl = async () => { throw new Error("network down"); };
  const summary = await runPressureMonitor({ source: "test-fail", fetchImpl });
  assert.ok(summary.syncFailures.length === allSecids().length, "所有 secid 抓取失败被记录");
  assert.ok(Array.isArray(summary.themes) && summary.themes.length === 2, "仍用已有数据算出两主题");
});
