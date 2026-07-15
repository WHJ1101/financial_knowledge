// 走势图交互的公共 hook 与纯换算函数（.doc 持仓/压力走势图交互增强）。
// 换算逻辑抽成纯函数便于单测；hook 只包状态与事件绑定（rAF 节流 / wheel passive:false / window 拖拽）。
import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// —— 纯换算函数（无 DOM、无副作用，可直接单测）——

// 夹紧到 [lo, hi]。
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 鼠标 clientX + 元素矩形 → 可见区间内的数据索引（0..pointCount-1）。
// viewStart 为可见区间起点索引，viewCount 为可见点数（缩放后 < pointCount）。
export function xToIndex(clientX, rectLeft, rectWidth, viewStart, viewCount) {
  if (!rectWidth || viewCount <= 1) return viewStart;
  const ratio = clamp((clientX - rectLeft) / rectWidth, 0, 1);
  return viewStart + Math.round(ratio * (viewCount - 1));
}

// 夹紧可见区间：保证 start<=end、下限 >=2 点、落在 [0, total-1] 内。
export function clampView(start, end, total) {
  if (total <= 0) return { start: 0, end: 0 };
  const maxEnd = total - 1;
  let s = Math.round(start);
  let e = Math.round(end);
  s = clamp(s, 0, maxEnd);
  e = clamp(e, 0, maxEnd);
  if (e < s) [s, e] = [e, s];
  if (e - s < 1) { // 至少 2 点
    if (s + 1 <= maxEnd) e = s + 1; else s = e - 1;
  }
  return { start: s, end: e };
}

// 以光标锚点缩放可见区间。factor<1 放大（区间收窄），factor>1 缩小（区间放宽）。
// anchorRatio 为光标在当前可见宽度中的比例（0..1），锚点数据索引缩放前后不动。
export function zoomView(view, total, factor, anchorRatio) {
  const count = view.end - view.start + 1;
  const anchorIdx = view.start + anchorRatio * (count - 1);
  const newCount = clamp(count * factor, 2, total);
  const newStart = anchorIdx - anchorRatio * (newCount - 1);
  return clampView(newStart, newStart + newCount - 1, total);
}

// 平移可见区间：deltaIdx 为要移动的索引数（正=向未来/右，负=向过去/左）。区间宽度不变。
export function panView(view, total, deltaIdx) {
  const count = view.end - view.start + 1;
  let start = view.start + deltaIdx;
  start = clamp(start, 0, total - count);
  return clampView(start, start + count - 1, total);
}

// —— 交互 hook ——

// 悬浮定位：返回 hoverIndex（相对整条数据的索引）与事件绑定。rAF 节流；disabled(拖拽中)时不更新。
// viewRef 传入当前可见区间的 getter，保证换算基于最新 view 而不闭包旧值。
export function useLineHover(svgRef, getView, pointCount, disabled = false) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const rafRef = useRef(null);
  const pendingX = useRef(0);

  const onMouseMove = useCallback((e) => {
    if (disabled) return;
    pendingX.current = e.clientX;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const view = getView();
      const count = view.end - view.start + 1;
      setHoverIndex(xToIndex(pendingX.current, rect.left, rect.width, view.start, count));
    });
  }, [svgRef, getView, disabled]);

  const onMouseLeave = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setHoverIndex(null);
  }, []);

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  return { hoverIndex, bindHover: { onMouseMove, onMouseLeave } };
}

// 缩放 + 平移可见区间。滚轮 passive:false 手动挂载防页面滚动；拖拽在 window 上监听防移出丢事件。
export function useZoomPan(svgRef, pointCount) {
  const total = Math.max(1, pointCount);
  const [view, setView] = useState({ start: 0, end: total - 1 });
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  // pointCount 变化（切 range / 指标）→ 复位到全区间。
  useEffect(() => {
    setView({ start: 0, end: Math.max(0, pointCount - 1) });
  }, [pointCount]);

  const reset = useCallback(() => setView({ start: 0, end: Math.max(0, pointCount - 1) }), [pointCount]);

  // 滚轮缩放：onWheel 属性在 preact 下可能 passive，preventDefault 失效 → 手动 addEventListener。
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const anchorRatio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2; // 下滚缩小、上滚放大
      setView((v) => zoomView(v, total, factor, anchorRatio));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, total]);

  // 拖拽平移：mousedown 起拖，window 监听 move/up。
  const onMouseDown = useCallback((e) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startView = viewRef.current;
    const count = startView.end - startView.start + 1;
    if (count >= total) return; // 未缩放时无需平移
    setDragging(true);
    const onMove = (ev) => {
      const dxPx = ev.clientX - startX;
      const deltaIdx = -Math.round((dxPx / rect.width) * (count - 1)); // 右拖 → 看更早
      setView(panView(startView, total, deltaIdx));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [svgRef, total]);

  const isZoomed = view.start > 0 || view.end < total - 1;
  const getView = useCallback(() => viewRef.current, []);

  return { view, isZoomed, reset, dragging, bindPan: { onMouseDown }, getView };
}
