import { existsSync, unlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { DATA_DIR } from "./db.js";

export const REPORT_DIR = join(DATA_DIR, "reports");

export async function ensureReportRoot() {
  await mkdir(REPORT_DIR, { recursive: true });
}

export function buildReportFile(localDay, id) {
  return localDay + "/" + id + ".html";
}

export async function writeReportFile(file, html) {
  const target = resolveReportFilePath(file);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, html, "utf8");
}

export function deleteReportFile(file) {
  if (!file) return false;
  const filePath = resolveReportFilePath(file);
  try {
    unlinkSync(filePath);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

export function reportFileExists(file) {
  if (!file) return false;
  try {
    return existsSync(resolveReportFilePath(file));
  } catch {
    return false;
  }
}

export function resolveReportFilePath(file) {
  const base = resolve(REPORT_DIR);
  const target = resolve(REPORT_DIR, file || "");
  if (target !== base && target.startsWith(base + sep)) return target;
  throw Object.assign(new Error("Forbidden report path"), { statusCode: 403 });
}
