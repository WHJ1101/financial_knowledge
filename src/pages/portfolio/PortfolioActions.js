import { del, post, put } from "../../api.js";
import { loadPortfolio, loadPortfolioHistory, portfolioHistory, showToast } from "../../store.js";
import { confirmDelete } from "../../lib/confirm.js";

export const pendingAnimate = new Set();

// 持仓变更后刷新曲线：组合曲线的当前仓位口径必须随 positions 实时变化（§5.3）。
function refreshPortfolioHistory() {
  loadPortfolioHistory(portfolioHistory.value.range);
}

export async function reanalyzeStock(code) {
  try {
    await post(`/api/stocks/${encodeURIComponent(code)}/analyze`);
    pendingAnimate.add(code);
    await loadPortfolio();
    showToast("重新分析中...");
  } catch (err) { showToast(`操作失败：${err.message}`); }
}

export async function deleteStock(code, name = "该自选") {
  if (!confirmDelete(name, "此操作会移除自选标的。")) return;
  try {
    await del(`/api/stocks/${encodeURIComponent(code)}`);
    await loadPortfolio();
    showToast("已删除");
  } catch (err) { showToast(`删除失败：${err.message}`); }
}

export async function reanalyzePosition(id) {
  try {
    await post(`/api/positions/${encodeURIComponent(id)}/analyze`);
    pendingAnimate.add(id);
    await loadPortfolio();
    showToast("重新分析中...");
  } catch (err) { showToast(`操作失败：${err.message}`); }
}

export async function updatePosition(id, form) {
  try {
    await put(`/api/positions/${encodeURIComponent(id)}`, {
      shares: Number(form.shares) || 0,
      cost: Number(form.cost) || 0
    });
    pendingAnimate.add(id);
    await loadPortfolio();
    refreshPortfolioHistory();
    showToast("已更新，重新分析中...");
  } catch (err) { showToast(`更新失败：${err.message}`); }
}

export async function deletePosition(id, name = "该持仓") {
  if (!confirmDelete(name, "此操作会移除持仓记录。")) return;
  try {
    await del(`/api/positions/${encodeURIComponent(id)}`);
    await loadPortfolio();
    refreshPortfolioHistory();
    showToast("已删除");
  } catch (err) { showToast(`删除失败：${err.message}`); }
}
