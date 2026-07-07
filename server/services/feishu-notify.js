// 飞书压力推送编排：把压力快照渲染成交互式卡片并推送。
// - notifyPressureCrossings：跨阈值告警（挂 pressure-monitor 跨阈值后）。
// - notifyDailyPressureBriefing：每日压力摘要（挂 daily-job 收盘后）。
// 通道优先级：自定义机器人 webhook（免权限、免发版）> 应用机器人 im/v1/messages。
// 设计约束：两通道都未配置时静默跳过；发送异常一律吞掉并记日志，绝不阻断日更主流程。
import { isFeishuPushConfigured, sendFeishuMessage } from "../../lib/feishuBot.js";
import { isFeishuWebhookConfigured, sendFeishuWebhook } from "../../lib/feishuWebhook.js";
import { UPPER_THRESHOLD, LOWER_THRESHOLD } from "../../lib/pressure-index.js";
import { localDateTimeWithWeekday } from "../../lib/datetime.js";
import { appendLog } from "./logs.js";

// 跨阈值告警：仅推送 crossing 非空的主题。无跨阈值或未配置则跳过。
export async function notifyPressureCrossings(themes = [], { now = new Date(), fetchImpl } = {}) {
  const crossings = (themes || []).filter((t) => t.crossing);
  if (!crossings.length) return { skipped: true, reason: "无跨阈值主题" };
  return safeSend({
    card: buildCrossingCard(crossings, now),
    text: crossings.map((t) => plainCrossingLine(t)).join("\n"),
    logMessage: `Pressure crossing alert pushed (${crossings.length})`,
    logMeta: { themes: crossings.map((t) => ({ id: t.id, crossing: t.crossing, composite: t.composite })) },
    now,
    fetchImpl
  });
}

// 每日压力摘要：推送全部主题当前压力分与状态。
export async function notifyDailyPressureBriefing(themes = [], { now = new Date(), fetchImpl } = {}) {
  const valid = (themes || []).filter((t) => t.composite != null);
  if (!valid.length) return { skipped: true, reason: "无有效压力数据" };
  return safeSend({
    card: buildDailyCard(valid, now),
    text: valid.map((t) => `${t.name}：压力 ${t.composite}（${t.status}）`).join("\n"),
    logMessage: `Daily pressure briefing pushed (${valid.length})`,
    logMeta: { themes: valid.map((t) => ({ id: t.id, composite: t.composite, status: t.status })) },
    now,
    fetchImpl
  });
}

// 统一的发送包装：按通道优先级发送；未配置跳过；成功/失败都记日志，失败不上抛。
// webhook 优先（免权限/免发版），未配置 webhook 再走 app-bot。
async function safeSend({ card, text, logMessage, logMeta, now, fetchImpl }) {
  const channel = pickChannel();
  if (!channel) return { skipped: true, reason: "未配置飞书推送（webhook 或应用机器人接收方缺失）" };
  try {
    const message = channel === "webhook"
      ? await sendFeishuWebhook({ card, text, fetchImpl, now })
      : await sendFeishuMessage({ card, text, fetchImpl });
    const messageId = message?.message_id || null;
    appendLog("feishu_push", logMessage, { ...logMeta, channel, ok: true, messageId });
    return { ok: true, channel, messageId };
  } catch (error) {
    const reason = String(error.message || error).slice(0, 300);
    appendLog("feishu_push", `Feishu push failed: ${reason}`, { ...logMeta, channel, ok: false });
    return { ok: false, channel, error: reason };
  }
}

// 选择推送通道：webhook > app-bot > null（都未配置）。
function pickChannel() {
  if (isFeishuWebhookConfigured()) return "webhook";
  if (isFeishuPushConfigured()) return "app-bot";
  return null;
}

// —— 卡片构造 ——

function buildCrossingCard(crossings, now) {
  const anyUp = crossings.some((t) => t.crossing === "up-70");
  const elements = [];
  crossings.forEach((theme, index) => {
    if (index > 0) elements.push({ tag: "hr" });
    elements.push({ tag: "div", text: { tag: "lark_md", content: crossingHeadline(theme) } });
    elements.push({ tag: "div", text: { tag: "lark_md", content: subScoreLines(theme) } });
  });
  elements.push({ tag: "hr" });
  elements.push(footerNote(now));

  return {
    config: { wide_screen_mode: true },
    header: {
      template: anyUp ? "red" : "green",
      title: { tag: "plain_text", content: anyUp ? "⚠️ 板块压力上穿告警" : "🟢 板块压力下穿提示" }
    },
    elements
  };
}

function buildDailyCard(themes, now) {
  const elements = [];
  themes.forEach((theme, index) => {
    if (index > 0) elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      fields: [
        { is_short: true, text: { tag: "lark_md", content: `**${theme.name}**\n${theme.market}` } },
        { is_short: true, text: { tag: "lark_md", content: `**压力指数**\n${gaugeEmoji(theme.composite)} ${theme.composite} / 100` } },
        { is_short: false, text: { tag: "lark_md", content: `**状态**：${theme.status}` } }
      ]
    });
    elements.push({ tag: "div", text: { tag: "lark_md", content: subScoreLines(theme) } });
  });
  elements.push({ tag: "hr" });
  elements.push(footerNote(now));

  return {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: "📊 每日板块压力摘要" }
    },
    elements
  };
}

function crossingHeadline(theme) {
  const isUp = theme.crossing === "up-70";
  const arrow = isUp ? "🔺 上穿" : "🔻 下穿";
  const line = isUp ? UPPER_THRESHOLD : LOWER_THRESHOLD;
  return `**${theme.name}**（${theme.market}）压力指数 ${arrow} ${line}\n当前 **${theme.composite}**，${theme.status}`;
}

function subScoreLines(theme) {
  const parts = (theme.subScores || []).map((s) => `· ${s.label}：${s.score ?? "-"}（${s.rawText}）`);
  return parts.length ? parts.join("\n") : "· 暂无分项数据";
}

function plainCrossingLine(theme) {
  const isUp = theme.crossing === "up-70";
  const line = isUp ? UPPER_THRESHOLD : LOWER_THRESHOLD;
  return `${theme.name} 压力${isUp ? "上穿" : "下穿"}${line}：${theme.composite}（${theme.status}）`;
}

function footerNote(now) {
  return {
    tag: "note",
    elements: [{ tag: "lark_md", content: `板块压力监控 · ${localDateTimeWithWeekday(now)}` }]
  };
}

function gaugeEmoji(composite) {
  if (composite == null) return "⚪️";
  if (composite >= UPPER_THRESHOLD) return "🔴";
  if (composite <= LOWER_THRESHOLD) return "🟢";
  return "🟡";
}
