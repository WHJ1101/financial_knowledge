import db from "./db.js";
import { localDateTime } from "../../lib/datetime.js";

export function appendLog(type, message, meta = {}) {
  db.prepare("INSERT INTO logs (id,type,message,meta,created_at,local_time) VALUES (?,?,?,?,?,?)").run(
    makeLogId(),
    type,
    message,
    JSON.stringify(meta),
    new Date().toISOString(),
    localDateTime()
  );
}

function makeLogId() {
  return Date.now() + "-" + Math.random().toString(16).slice(2);
}
