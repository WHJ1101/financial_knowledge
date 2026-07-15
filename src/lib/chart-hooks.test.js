import assert from "node:assert/strict";
import test from "node:test";

import { clamp, xToIndex, clampView, zoomView, panView } from "./chart-hooks.js";

test("clamp bounds value", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test("xToIndex maps pixel ratio to data index within view", () => {
  // 可见区间 [10..19]（10 点），宽 200px
  assert.equal(xToIndex(0, 0, 200, 10, 10), 10);   // 最左 → start
  assert.equal(xToIndex(200, 0, 200, 10, 10), 19); // 最右 → end
  assert.equal(xToIndex(100, 0, 200, 10, 10), 15); // 中点 → 中间索引
  // 超出边界 clamp
  assert.equal(xToIndex(-50, 0, 200, 10, 10), 10);
  assert.equal(xToIndex(500, 0, 200, 10, 10), 19);
});

test("xToIndex handles rectLeft offset and degenerate width", () => {
  assert.equal(xToIndex(150, 50, 200, 0, 10), 5); // (150-50)/200=0.5 → idx 5 (of 0..9)
  assert.equal(xToIndex(100, 0, 0, 3, 5), 3);     // 零宽 → 返回 viewStart
});

test("clampView enforces min 2 points and bounds", () => {
  assert.deepEqual(clampView(0, 9, 10), { start: 0, end: 9 });
  assert.deepEqual(clampView(5, 5, 10), { start: 5, end: 6 }); // 单点 → 撑到 2 点
  assert.deepEqual(clampView(9, 9, 10), { start: 8, end: 9 }); // 末尾单点 → 向前撑
  assert.deepEqual(clampView(-3, 20, 10), { start: 0, end: 9 }); // 越界夹紧
  assert.deepEqual(clampView(8, 2, 10), { start: 2, end: 8 }); // 反序纠正
});

test("zoomView zooms in around anchor, keeps anchor stable-ish", () => {
  const full = { start: 0, end: 99 }; // 100 点
  // 放大(factor<1) 锚点在中间 → 区间收窄且大致居中
  const zoomed = zoomView(full, 100, 0.5, 0.5);
  const count = zoomed.end - zoomed.start + 1;
  assert.ok(count < 100 && count >= 2, `收窄到 ${count}`);
  assert.ok(zoomed.start > 0 && zoomed.end < 99, "两端都收进来");
});

test("zoomView anchor at left edge keeps left fixed", () => {
  const full = { start: 0, end: 99 };
  const zoomed = zoomView(full, 100, 0.5, 0); // 锚点最左
  assert.equal(zoomed.start, 0, "左锚 → start 不动");
  assert.ok(zoomed.end < 99);
});

test("zoomView never below 2 points", () => {
  let v = { start: 40, end: 59 };
  for (let i = 0; i < 20; i++) v = zoomView(v, 100, 0.5, 0.5); // 疯狂放大
  assert.ok(v.end - v.start + 1 >= 2, "下限 2 点，不塌缩");
});

test("zoomView zoom out clamps to full range", () => {
  let v = { start: 40, end: 49 };
  for (let i = 0; i < 20; i++) v = zoomView(v, 100, 1.2, 0.5); // 疯狂缩小
  assert.deepEqual(v, { start: 0, end: 99 }, "缩小到底 = 全区间");
});

test("panView shifts window without changing width, clamps at edges", () => {
  const v = { start: 40, end: 59 }; // 20 点宽
  const right = panView(v, 100, 10);
  assert.deepEqual(right, { start: 50, end: 69 });
  const left = panView(v, 100, -10);
  assert.deepEqual(left, { start: 30, end: 49 });
  // 撞右边界：宽度保持 20
  const past = panView(v, 100, 999);
  assert.deepEqual(past, { start: 80, end: 99 });
  const before = panView(v, 100, -999);
  assert.deepEqual(before, { start: 0, end: 19 });
});
