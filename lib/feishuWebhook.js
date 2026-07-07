// 飞书自定义机器人 webhook 推送通道。
// 相比 app-bot（im/v1/messages）：无需申请权限、无需发布版本、无需拉机器人进群，
// webhook 地址本身绑定目标群。缺点是只能发到该固定群、且是单向。
// 与 app-bot 共用同一份卡片结构（feishu-notify 构造的 v1 卡片，webhook 同样接受）。
import { createHmac } from "node:crypto";

import { fetchFeishuJson } from "./feishuClient.js";

// 是否配置了 webhook 地址。
export function isFeishuWebhookConfigured() {
  return Boolean(process.env.FEISHU_WEBHOOK_URL);
}

// 通过自定义机器人 webhook 发送消息。card 优先（顶层 card 字段），否则回退 text。
// 配置了 secret（FEISHU_WEBHOOK_SECRET）时附加 timestamp + sign 签名校验。
export async function sendFeishuWebhook({
  card,
  text,
  webhookUrl = process.env.FEISHU_WEBHOOK_URL,
  secret = process.env.FEISHU_WEBHOOK_SECRET,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  if (!webhookUrl) throw new Error("缺少 FEISHU_WEBHOOK_URL");

  const payload = buildWebhookPayload({ card, text });
  if (secret) {
    // 飞书签名要求「距当前不超过 1 小时」的秒级时间戳。
    const timestamp = Math.floor((now?.getTime?.() ?? Date.now()) / 1000);
    payload.timestamp = String(timestamp);
    payload.sign = genWebhookSign(timestamp, secret);
  }

  // webhook 成功响应为 { code: 0, ... }，与开放平台一致，可复用 fetchFeishuJson 的 code 校验。
  const json = await fetchFeishuJson({
    fetchImpl,
    url: webhookUrl,
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });

  return json.data || json;
}

// 依据传参组装 webhook body。飞书自定义机器人：卡片放顶层 card（对象），文本放 content.text。
function buildWebhookPayload({ card, text }) {
  if (card) return { msg_type: "interactive", card };
  const value = String(text ?? "").trim();
  if (!value) throw new Error("飞书消息内容为空");
  return { msg_type: "text", content: { text: value } };
}

// 飞书特有签名：以「timestamp\n密钥」为 HmacSHA256 的 key，对空字符串签名，再 Base64。
function genWebhookSign(timestamp, secret) {
  return createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}
