import db from "../services/db.js";

export function getSettings() {
  const rows = db.prepare("SELECT * FROM settings").all();
  const settings = {};
  for (const row of rows) settings[row.key] = JSON.parse(row.value);
  return { automationEnabled: false, lastDailyRun: null, schedule: "08:30 Asia/Shanghai", ...settings };
}

export function toggleAutomation(body) {
  const current = getSettings();
  const next = typeof body.enabled === "boolean" ? body.enabled : !current.automationEnabled;
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("automationEnabled", JSON.stringify(next));
  return getSettings();
}
