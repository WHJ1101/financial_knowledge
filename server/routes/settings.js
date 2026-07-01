import db from "../services/db.js";
import {
  DEFAULT_DAILY_SCHEDULE_TIME,
  displayDailySchedule,
  formatDailySchedule,
  normalizeDailyScheduleTime,
  parseDailyScheduleTime
} from "../services/schedule-config.js";

export function getSettings() {
  const rows = db.prepare("SELECT * FROM settings").all();
  const settings = {};
  for (const row of rows) settings[row.key] = JSON.parse(row.value);
  const dailyTask = db.prepare("SELECT schedule FROM automation_tasks WHERE id='daily-research'").get();
  const dailyScheduleTime =
    parseDailyScheduleTime(dailyTask?.schedule) ||
    normalizeDailyScheduleTime(settings.dailyScheduleTime) ||
    parseDailyScheduleTime(settings.schedule) ||
    DEFAULT_DAILY_SCHEDULE_TIME;

  return {
    automationEnabled: false,
    lastDailyRun: null,
    ...settings,
    scheduleMode: "per-task",
    dailyScheduleTime,
    schedule: formatDailySchedule(dailyScheduleTime),
    scheduleLabel: displayDailySchedule(dailyScheduleTime)
  };
}

export function toggleAutomation(body) {
  const current = getSettings();
  const next = typeof body.enabled === "boolean" ? body.enabled : !current.automationEnabled;
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("automationEnabled", JSON.stringify(next));
  return getSettings();
}

export function updateDailySchedule(body = {}) {
  const time = normalizeDailyScheduleTime(body.time || body.dailyScheduleTime);
  if (!time) throw Object.assign(new Error("请输入有效的执行时间，格式为 HH:mm"), { statusCode: 400 });
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("dailyScheduleTime", JSON.stringify(time));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("schedule", JSON.stringify(formatDailySchedule(time)));
  db.prepare("UPDATE automation_tasks SET schedule=?, updated_at=? WHERE id='daily-research'").run(formatDailySchedule(time), new Date().toISOString());
  return getSettings();
}
