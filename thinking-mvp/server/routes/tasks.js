import db from "../services/db.js";

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
  db.prepare(`INSERT INTO automation_tasks (id,name,enabled,goal,implementation,prompt,schedule,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, name, 0, goal, implementation, prompt, body.schedule || "手动触发", now, now
  );
  return { id, name, enabled: false, goal, implementation, prompt, schedule: body.schedule || "手动触发", createdAt: now, updatedAt: now };
}

export function toggleTask(id) {
  const now = new Date().toISOString();
  db.prepare("UPDATE automation_tasks SET enabled = CASE WHEN enabled=1 THEN 0 ELSE 1 END, updated_at=? WHERE id=?").run(now, id);
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
  return { id: row.id, name: row.name, enabled: !!row.enabled, goal: row.goal, implementation: row.implementation, prompt: row.prompt, schedule: row.schedule, createdAt: row.created_at, updatedAt: row.updated_at };
}
