// 飞书应用机器人发送原语：复用 feishuClient 的 tenant_access_token，
// 调 im/v1/messages 向指定会话/个人发送消息。支持 interactive 卡片与纯文本。
// 供 feishu-notify（压力告警 / 每日简报推送）调用，与 feishuSource 共用同一套凭证。
import { FEISHU_BASE_URL, fetchFeishuJson, feishuAuthHeaders, getTenantAccessToken, isFeishuConfigured } from "./feishuClient.js";

// 默认接收方来自环境变量：优先群 chat_id，其次用户 open_id / user_id / email。
// receive_id_type 与 receiveId 必须匹配，见 resolveReceiver。
export function resolveReceiver(explicit = {}) {
  const chatId = explicit.chatId || process.env.FEISHU_PUSH_CHAT_ID;
  if (chatId) return { receiveIdType: "chat_id", receiveId: chatId };

  const openId = explicit.openId || process.env.FEISHU_PUSH_OPEN_ID;
  if (openId) return { receiveIdType: "open_id", receiveId: openId };

  const userId = explicit.userId || process.env.FEISHU_PUSH_USER_ID;
  if (userId) return { receiveIdType: "user_id", receiveId: userId };

  const email = explicit.email || process.env.FEISHU_PUSH_EMAIL;
  if (email) return { receiveIdType: "email", receiveId: email };

  return null;
}

// 是否具备推送能力：应用凭证 + 至少一个接收方。
export function isFeishuPushConfigured(explicit = {}) {
  return isFeishuConfigured() && Boolean(resolveReceiver(explicit));
}

// 发送一条消息。card 优先（interactive），否则回退到 text。
// 返回飞书 message 数据；未配置凭证/接收方时抛错，由上层编排决定吞掉还是上抛。
export async function sendFeishuMessage({
  card,
  text,
  receiver,
  appId = process.env.FEISHU_APP_ID,
  appSecret = process.env.FEISHU_APP_SECRET,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!appId || !appSecret) throw new Error("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET");

  const target = receiver && receiver.receiveId ? receiver : resolveReceiver(receiver || {});
  if (!target) throw new Error("缺少飞书接收方：请设置 FEISHU_PUSH_CHAT_ID / FEISHU_PUSH_OPEN_ID / FEISHU_PUSH_USER_ID / FEISHU_PUSH_EMAIL");

  const { msgType, content } = buildMessagePayload({ card, text });
  const tenantAccessToken = await getTenantAccessToken({ appId, appSecret, fetchImpl });

  const url = new URL(`${FEISHU_BASE_URL}/open-apis/im/v1/messages`);
  url.searchParams.set("receive_id_type", target.receiveIdType);

  const json = await fetchFeishuJson({
    fetchImpl,
    url,
    method: "POST",
    headers: {
      ...feishuAuthHeaders(tenantAccessToken),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      receive_id: target.receiveId,
      msg_type: msgType,
      content: JSON.stringify(content)
    })
  });

  return json.data || json;
}

// 依据传参决定消息类型与 content。飞书要求 content 为「JSON 字符串」，此处返回对象，序列化在发送处统一做。
function buildMessagePayload({ card, text }) {
  if (card) return { msgType: "interactive", content: card };
  const value = String(text ?? "").trim();
  if (!value) throw new Error("飞书消息内容为空");
  return { msgType: "text", content: { text: value } };
}
