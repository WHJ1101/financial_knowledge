import assert from "node:assert/strict";
import test from "node:test";

import { localDate, localDateTime, localDateTimeWithWeekday, localHour } from "./datetime.js";

const FIXED = new Date("2026-06-30T02:30:45.000Z"); // 上海时间 2026-06-30 10:30:45（周二）

test("localDate returns YYYY-MM-DD in Shanghai time", () => {
  assert.equal(localDate(FIXED), "2026-06-30");
});

test("localDate crosses date boundary correctly", () => {
  // UTC 22:00 → 上海次日 06:00
  assert.equal(localDate(new Date("2026-06-29T22:00:00.000Z")), "2026-06-30");
});

test("localDateTime returns YYYY-MM-DD HH:mm:ss", () => {
  assert.equal(localDateTime(FIXED), "2026-06-30 10:30:45");
});

test("localDateTimeWithWeekday prefixes the weekday", () => {
  assert.match(localDateTimeWithWeekday(FIXED), /· 2026-06-30 10:30:45$/);
});

test("localHour returns the Shanghai hour", () => {
  assert.equal(localHour(FIXED), 10);
});
