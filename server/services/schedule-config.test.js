import assert from "node:assert/strict";
import test from "node:test";

import {
  displayDailySchedule,
  formatDailySchedule,
  normalizeDailyScheduleTime,
  parseDailyScheduleTime,
  scheduleParts
} from "./schedule-config.js";

test("normalizes valid daily schedule time", () => {
  assert.equal(normalizeDailyScheduleTime("08:30"), "08:30");
  assert.equal(normalizeDailyScheduleTime("23:59"), "23:59");
});

test("rejects invalid daily schedule time", () => {
  assert.equal(normalizeDailyScheduleTime("8:30"), null);
  assert.equal(normalizeDailyScheduleTime("25:00"), null);
  assert.equal(normalizeDailyScheduleTime("08:70"), null);
});

test("parses legacy schedule strings", () => {
  assert.equal(parseDailyScheduleTime("08:30 Asia/Shanghai"), "08:30");
  assert.equal(parseDailyScheduleTime("08:30 中国标准时间"), "08:30");
});

test("formats schedule for API and UI", () => {
  assert.equal(formatDailySchedule("09:15"), "09:15 Asia/Shanghai");
  assert.equal(displayDailySchedule("09:15"), "09:15 中国标准时间");
  assert.deepEqual(scheduleParts("09:15"), { hour: 9, minute: 15, time: "09:15" });
});
