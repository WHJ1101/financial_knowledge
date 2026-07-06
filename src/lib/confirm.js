export function confirmDanger(message) {
  if (!globalThis.confirm) return true;
  return globalThis.confirm(message);
}

export function confirmDelete(name, detail = "此操作不可撤销。") {
  const label = name ? "「" + name + "」" : "该项目";
  return confirmDanger("确认删除" + label + "？" + detail);
}

export function confirmArchive(name) {
  const label = name ? "「" + name + "」" : "该报告";
  return confirmDanger("确认归档" + label + "？归档后将从默认列表中隐藏。");
}
