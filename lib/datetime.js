// 统一的时区与日期格式化工具，避免各模块各自硬编码 "Asia/Shanghai" 与格式化逻辑。
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

// 返回本地日期 YYYY-MM-DD。
export function localDate(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

// 返回本地日期时间 YYYY-MM-DD HH:mm:ss。
export function localDateTime(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const v = zonedParts(parts);
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}

// 返回带星期前缀的本地日期时间：周一 · YYYY-MM-DD HH:mm:ss。
export function localDateTimeWithWeekday(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const v = zonedParts(parts);
  return `${v.weekday} · ${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}

// 返回指定时区当前的小时（0-23）。
export function localHour(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return Number(new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", hour12: false }).format(date));
}

function zonedParts(parts) {
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}
