import db from "./db.js";
import { DEFAULT_TIME_ZONE, parseDailyScheduleTime, scheduleParts } from "./schedule-config.js";

const TIME_ZONE = DEFAULT_TIME_ZONE;

let timer = null;

function localDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function localParts() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { date: `${v.year}-${v.month}-${v.day}`, hour: Number(v.hour), minute: Number(v.minute) };
}

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : null;
}

function setSetting(key, value) {
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(key, JSON.stringify(value));
}

export function startScheduler(runTask) {
  timer = setInterval(async () => {
    try {
      const enabled = getSetting("automationEnabled");
      if (!enabled) return;
      const now = localParts();
      const tasks = db.prepare("SELECT * FROM automation_tasks WHERE enabled=1 ORDER BY created_at DESC").all();

      for (const task of tasks) {
        const scheduleTime = parseDailyScheduleTime(task.schedule);
        if (!scheduleTime) continue;
        const schedule = scheduleParts(scheduleTime);
        const isAfter = now.hour > schedule.hour || (now.hour === schedule.hour && now.minute >= schedule.minute);
        const runKey = `lastAutomationTaskRun:${task.id}`;
        const lastRun = getSetting(runKey);
        if (isAfter && lastRun !== now.date) {
          await runTask(task);
          setSetting(runKey, now.date);
        }
      }
    } catch (e) { console.error("Scheduler error:", e); }
  }, 60_000);
}

export function stopScheduler() { if (timer) clearInterval(timer); }
