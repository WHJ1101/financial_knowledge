import db from "./db.js";
import { DEFAULT_TIME_ZONE, parseDailyScheduleTime, scheduleParts } from "./schedule-config.js";

const TIME_ZONE = DEFAULT_TIME_ZONE;

let timer = null;
let running = false;

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
    // 重叠防护：上一次 tick 仍在执行（任务可能耗时超过 60s）时跳过本次，避免并发重入。
    if (running) return;
    running = true;
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
          // 先占位再执行：即便任务抛错也不重复触发，且单任务失败不影响后续任务。
          setSetting(runKey, now.date);
          try {
            await runTask(task);
          } catch (e) {
            console.error(`Scheduler task failed [${task.id}]:`, e);
          }
        }
      }
    } catch (e) {
      console.error("Scheduler error:", e);
    } finally {
      running = false;
    }
  }, 60_000);
}

export function stopScheduler() { if (timer) clearInterval(timer); }
