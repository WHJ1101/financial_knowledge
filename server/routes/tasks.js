import db from "../services/db.js";
import { displayDailySchedule, formatDailySchedule, normalizeDailyScheduleTime, parseDailyScheduleTime } from "../services/schedule-config.js";

export function getTasks() {
  return db.prepare("SELECT * FROM automation_tasks ORDER BY created_at DESC").all().map(formatTask);
}

export function createTask(body) {
  const name = String(body.name || "").trim();
  const goal = String(body.goal || "").trim();
  const implementation = String(body.implementation || "").trim();
  if (!name || !goal || !implementation) throw Object.assign(new Error("任务名称、目标和实现必填"), { statusCode: 400 });
  const now = new Date().toISOString();
  const id = `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const prompt = `任务名称：${name}\n任务目标：${goal}\n执行方式：${implementation}\n请在执行时先收集可复核证据，再输出结论、风险、下一步动作。`;
  const schedule = normalizeTaskSchedule(body.schedule || body.scheduleTime);
  db.prepare(`INSERT INTO automation_tasks (id,name,enabled,goal,implementation,prompt,schedule,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, name, 0, goal, implementation, prompt, schedule, now, now
  );
  return formatTask({ id, name, enabled: 0, goal, implementation, prompt, schedule, created_at: now, updated_at: now });
}

export function toggleTask(id) {
  const now = new Date().toISOString();
  db.prepare("UPDATE automation_tasks SET enabled = CASE WHEN enabled=1 THEN 0 ELSE 1 END, updated_at=? WHERE id=?").run(now, id);
  const row = db.prepare("SELECT * FROM automation_tasks WHERE id=?").get(id);
  if (!row) throw Object.assign(new Error("Task not found"), { statusCode: 404 });
  return formatTask(row);
}

export function updateTaskSchedule(id, body = {}) {
  const scheduleTime = normalizeDailyScheduleTime(body.time || body.scheduleTime || body.schedule);
  if (!scheduleTime) throw Object.assign(new Error("请输入有效的执行时间，格式为 HH:mm"), { statusCode: 400 });
  const now = new Date().toISOString();
  db.prepare("UPDATE automation_tasks SET schedule=?, updated_at=? WHERE id=?").run(formatDailySchedule(scheduleTime), now, id);
  const row = db.prepare("SELECT * FROM automation_tasks WHERE id=?").get(id);
  if (!row) throw Object.assign(new Error("Task not found"), { statusCode: 404 });
  return formatTask(row);
}

export function getLogs() {
  return db.prepare("SELECT * FROM logs ORDER BY created_at DESC LIMIT 200").all().map(row => ({
    ...row, meta: JSON.parse(row.meta || "{}")
  }));
}

function formatTask(row) {
  const scheduleTime = parseDailyScheduleTime(row.schedule);
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    goal: row.goal,
    implementation: row.implementation,
    prompt: row.prompt,
    schedule: scheduleTime ? displayDailySchedule(scheduleTime) : row.schedule || "手动触发",
    scheduleTime: scheduleTime || "",
    executable: isDailyTask(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeTaskSchedule(value) {
  const time = normalizeDailyScheduleTime(value);
  return time ? formatDailySchedule(time) : "手动触发";
}

function isDailyTask(row) {
  return row.id === "daily-research" || /每日市场简报|日更/.test(`${row.name || ""} ${row.implementation || ""}`);
}
