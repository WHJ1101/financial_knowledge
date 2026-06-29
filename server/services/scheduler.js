import db from "./db.js";

const TIME_ZONE = "Asia/Shanghai";
const DAILY_JOB_HOUR = 8;
const DAILY_JOB_MINUTE = 30;

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

export function startScheduler(runDailyJob) {
  timer = setInterval(async () => {
    try {
      const enabled = getSetting("automationEnabled");
      if (!enabled) return;
      const now = localParts();
      const isAfter = now.hour > DAILY_JOB_HOUR || (now.hour === DAILY_JOB_HOUR && now.minute >= DAILY_JOB_MINUTE);
      const lastRun = getSetting("lastDailyRun");
      if (isAfter && lastRun !== now.date) {
        await runDailyJob("scheduled");
        setSetting("lastDailyRun", now.date);
      }
    } catch (e) { console.error("Scheduler error:", e); }
  }, 60_000);
}

export function stopScheduler() { if (timer) clearInterval(timer); }
