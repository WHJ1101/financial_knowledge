export const DEFAULT_TIME_ZONE = "Asia/Shanghai";
export const DEFAULT_DAILY_SCHEDULE_TIME = "08:30";

export function normalizeDailyScheduleTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

export function parseDailyScheduleTime(value) {
  const text = String(value || "").trim();
  const direct = normalizeDailyScheduleTime(text);
  if (direct) return direct;
  const embedded = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  return embedded ? `${embedded[1]}:${embedded[2]}` : null;
}

export function formatDailySchedule(time = DEFAULT_DAILY_SCHEDULE_TIME) {
  return `${normalizeDailyScheduleTime(time) || DEFAULT_DAILY_SCHEDULE_TIME} ${DEFAULT_TIME_ZONE}`;
}

export function displayDailySchedule(time = DEFAULT_DAILY_SCHEDULE_TIME) {
  return `${normalizeDailyScheduleTime(time) || DEFAULT_DAILY_SCHEDULE_TIME} 中国标准时间`;
}

export function scheduleParts(time = DEFAULT_DAILY_SCHEDULE_TIME) {
  const normalized = normalizeDailyScheduleTime(time) || DEFAULT_DAILY_SCHEDULE_TIME;
  const [hour, minute] = normalized.split(":").map(Number);
  return { hour, minute, time: normalized };
}
