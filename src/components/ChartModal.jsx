// 通用图表放大弹层（.doc 交互增强）。项目此前无 modal 设施，这里提供一个轻量受控弹层：
// fixed 全屏遮罩 + 居中卡片，Esc / 点遮罩关闭。preact 直接挂在组件树内，z-index 盖过 topbar(5)。
import { useEffect } from "preact/hooks";

export function ChartModal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div class="chart-modal-backdrop" onClick={onClose}>
      <div class="chart-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title || "图表"}>
        <header class="chart-modal-head">
          <strong>{title}</strong>
          <button type="button" class="chart-modal-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div class="chart-modal-body">{children}</div>
      </div>
    </div>
  );
}
