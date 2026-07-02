export function isDailyBriefingTask(task = {}) {
  return task.id === "daily-research" || /每日市场简报|日更/.test(`${task.name || ""} ${task.implementation || ""}`);
}
