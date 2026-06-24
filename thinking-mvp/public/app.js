const state = {
  reports: [],
  status: null,
  stocks: [],
  positions: [],
  indices: [],
  automationTasks: [],
  decisions: [],
  query: "",
  originFilter: "all",
  busy: false
};

const view = document.querySelector("#view");
const todayTemplate = document.querySelector("#todayTemplate");
const reportTemplate = document.querySelector("#reportTemplate");
const searchInput = document.querySelector("#searchInput");
const automationButton = document.querySelector("#automationButton");
const syncButton = document.querySelector("#syncButton");

const ROUTES = {
  today: { title: "今日" },
  wiki: { title: "知识库", description: "按报告归档浏览所有沉淀内容。" },
  stocks: { title: "股票", description: "维护自选个股标的，查看状态、最近报告、投资建议和风险提示。" },
  positions: { title: "持仓", description: "维护当前持仓。券商账号自动同步暂未接入，当前先支持手动添加持仓。" },
  etfs: { title: "指数基金", description: "展示主要市场指数，以及关联的指数基金和交易型基金。" },
  decisions: { title: "决策", description: "基于市场、自选股、持仓和当日报告生成每日决策指南。" },
  calendar: { title: "日历", description: "按日期查看报告生成与任务执行节奏。" },
  knowledge: { title: "知识", description: "整理产业链、政策、市场与论文类知识材料。" },
  candidates: { title: "候选", description: "聚合未读或待进一步验证的研究对象。" },
  suggestions: { title: "建议", description: "根据当前资料库状态给出下一步工作建议。" },
  workflow: { title: "工作流" },
  import: { title: "导入" },
  tasks: { title: "自动化任务", description: "查看、新增、开启或暂停自动化任务。" },
  logs: { title: "日志" },
  settings: { title: "设置", description: "查看本地服务、自动化和数据目录配置。" }
};

await refresh();
renderRoute();

window.setInterval(async () => {
  if (state.busy || isReportRoute()) return;
  await refresh();
  renderRoute();
}, 10_000);

window.addEventListener("hashchange", renderRoute);
searchInput.addEventListener("input", async (event) => {
  state.query = event.target.value.trim();
  await loadReports();
  if (!isReportRoute()) renderRoute();
});

automationButton.addEventListener("click", async () => {
  const next = !state.status?.settings?.automationEnabled;
  await postJson("/api/automation/toggle", { enabled: next });
  await refresh();
  toast(next ? "自动日更已开启" : "自动日更已暂停");
  renderRoute();
});

syncButton.addEventListener("click", async () => {
  await refresh();
  toast("已同步本地数据");
  renderRoute();
});

async function refresh() {
  await Promise.all([loadStatus(), loadReports(), loadBusinessData()]);
}

async function loadStatus() {
  state.status = await getJson("/api/status");
  automationButton.textContent = state.status.settings.automationEnabled
    ? "自动化 运行中"
    : "自动化 暂停";
}

async function loadReports() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  const query = params.toString() ? `?${params.toString()}` : "";
  const payload = await getJson(`/api/reports${query}`);
  state.reports = payload.reports;
}

async function loadBusinessData() {
  const [stocks, positions, indices, automationTasks, decisions] = await Promise.all([
    getJson("/api/stocks"),
    getJson("/api/positions"),
    getJson("/api/market-indices"),
    getJson("/api/automation/tasks"),
    getJson("/api/decisions")
  ]);
  state.stocks = stocks.stocks;
  state.positions = positions.positions;
  state.indices = indices.indices;
  state.automationTasks = automationTasks.tasks;
  state.decisions = decisions.decisions;
}

function renderRoute() {
  setActiveNav();
  const hash = window.location.hash || "#today";
  if (hash.startsWith("#report/")) {
    renderReport(readReportIdFromHash(hash));
    return;
  }

  const routeKey = routeKeyFromHash(hash);
  if (routeKey === "today") return renderToday();
  if (routeKey === "stocks") return renderStocksPage();
  if (routeKey === "positions") return renderPositionsPage();
  if (routeKey === "etfs") return renderEtfsPage();
  if (routeKey === "decisions") return renderDecisionsPage();
  if (routeKey === "tasks") return renderAutomationTasksPage();
  if (["workflow", "import", "logs"].includes(routeKey)) return renderComingSoonPage(routeKey);
  if (routeKey === "settings") return renderSettingsPage();
  if (routeKey === "calendar") return renderCalendarPage();
  if (routeKey === "suggestions") return renderSuggestionsPage();
  renderReportsRoutePage(routeKey);
}

function routeKeyFromHash(hash) {
  return (hash || "#today").replace(/^#/, "") || "today";
}

function renderToday() {
  const fragment = todayTemplate.content.cloneNode(true);
  view.replaceChildren(fragment);

  document.querySelector("#currentTime").textContent = state.status?.now || "--";
  document.querySelector("#todayCount").textContent = state.status?.todayUpdates ?? 0;
  document.querySelector("#unreadCount").textContent = state.status?.unreadCount ?? 0;

  document.querySelector("#researchForm").addEventListener("submit", handleResearchSubmit);
  document.querySelector("#runDailyButton").addEventListener("click", handleDailyRun);
  bindReportOriginFilters(view);
  renderReportSections();
}

function renderStocksPage() {
  const page = createPage("stocks");
  page.appendChild(buildStats([
    ["自选标的", state.stocks.length, "手动维护"],
    ["有报告标的", countStocksWithReports(), "按代码和名称匹配"]
  ]));
  page.appendChild(buildStockForm());
  page.appendChild(buildStockList());
  view.replaceChildren(page);
  bindBusinessActions();
}

function renderPositionsPage() {
  const page = createPage("positions");
  const totalCost = state.positions.reduce((sum, item) => sum + item.shares * item.cost, 0);
  page.appendChild(buildStats([
    ["持仓数量", state.positions.length, "手动维护"],
    ["持仓成本", formatMoney(totalCost), "仅按录入成本估算"]
  ]));
  page.appendChild(buildBrokerFallback());
  page.appendChild(buildPositionForm());
  page.appendChild(buildPositionList());
  view.replaceChildren(page);
  bindBusinessActions();
}

function renderEtfsPage() {
  const page = createPage("etfs");
  page.appendChild(buildStats([
    ["覆盖指数", state.indices.length, "A股、港股、美股"],
    ["行情状态", "待接入", "当前展示配置清单"]
  ]));
  page.appendChild(buildIndexGrid());
  view.replaceChildren(page);
}

function renderDecisionsPage() {
  const page = createPage("decisions");
  page.appendChild(buildStats([
    ["决策指南", state.decisions.length, "本地保存"],
    ["今日报告", state.status?.todayUpdates ?? 0, "用于生成指南"]
  ]));
  page.appendChild(buildDecisionActions());
  page.appendChild(buildDecisionList());
  view.replaceChildren(page);
  bindBusinessActions();
}

function renderAutomationTasksPage() {
  const page = createPage("tasks");
  const running = state.automationTasks.filter((task) => task.enabled).length;
  page.appendChild(buildStats([
    ["任务总数", state.automationTasks.length, "本地配置"],
    ["运行中", running, "可单独暂停"]
  ]));
  page.appendChild(buildAutomationTaskForm());
  page.appendChild(buildAutomationTaskList());
  view.replaceChildren(page);
  bindBusinessActions();
}

function renderComingSoonPage(routeKey) {
  const route = ROUTES[routeKey] || { title: "功能" };
  const page = createPage(routeKey, "功能未开发，敬请期待");
  const panel = document.createElement("section");
  panel.className = "board route-panel";
  panel.innerHTML = `
    <div class="empty-state">
      <h2>功能未开发，敬请期待</h2>
      <p>${escapeHtml(route.title)}页面暂时不承载业务逻辑，后续按优先级逐步实现。</p>
    </div>
  `;
  page.appendChild(panel);
  view.replaceChildren(page);
}

function renderSettingsPage() {
  const settings = state.status?.settings || {};
  const page = createPage("settings");
  page.appendChild(buildStats([
    ["报告总数", state.status?.reportCount ?? state.reports.length, "本地报告"],
    ["全局自动化", settings.automationEnabled ? "运行中" : "暂停", "顶部按钮可切换"]
  ]));
  const panel = document.createElement("section");
  panel.className = "board route-panel";
  panel.innerHTML = `
    <div class="board-head">
      <div>
        <h2>系统设置</h2>
        <p>当前只展示本地服务配置，自动化任务请在“任务”页面维护。</p>
      </div>
    </div>
    <div class="route-list">
      <div class="route-list-item"><span>日更计划</span><strong>${escapeHtml(formatSchedule(settings.schedule))}</strong></div>
      <div class="route-list-item"><span>上次日更</span><strong>${escapeHtml(settings.lastDailyRun || "未执行")}</strong></div>
      <div class="route-list-item"><span>知识库状态</span><strong>${settings.knowledgeStatus === "ok" ? "正常" : "异常"}</strong></div>
    </div>
  `;
  page.appendChild(panel);
  view.replaceChildren(page);
}

function renderCalendarPage() {
  const page = createPage("calendar");
  const groups = new Map();
  for (const report of state.reports) {
    const key = report.localDate || "未标注日期";
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const items = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const panel = document.createElement("section");
  panel.className = "board route-panel";
  panel.innerHTML = `
    <div class="board-head"><div><h2>报告日历</h2><p>按日期聚合报告数量。</p></div></div>
    <div class="route-list">
      ${items.map(([date, count]) => `<div class="route-list-item"><span>${escapeHtml(date)}</span><strong>${count} 篇报告</strong></div>`).join("")}
    </div>
  `;
  page.appendChild(panel);
  view.replaceChildren(page);
}

function renderSuggestionsPage() {
  const page = createPage("suggestions");
  const unread = state.reports.filter((report) => report.status !== "read").length;
  page.appendChild(buildCardGrid([
    ["处理未读报告", unread ? `当前还有 ${unread} 篇未读报告，建议先处理持仓和自选股相关内容。` : "当前没有未读报告。"],
    ["补充自选股", state.stocks.length ? "自选股已建立，可以补充关注理由和风险条件。" : "建议先添加自选标的。"],
    ["生成决策指南", "进入“决策”页面可手动生成每日决策指南。"]
  ]));
  view.replaceChildren(page);
}

function renderReportsRoutePage(routeKey) {
  const route = ROUTES[routeKey] || ROUTES.wiki;
  const page = createPage(routeKey);
  const reports = reportsForRoute(routeKey);
  page.appendChild(buildReportsPanel(route.title, reports, "暂无相关报告。"));
  view.replaceChildren(page);
}

function createPage(routeKey, overrideDescription) {
  const route = ROUTES[routeKey] || ROUTES.today;
  const page = document.createElement("section");
  page.className = "nav-page";
  page.innerHTML = `
    <div class="page-head">
      <p class="time-row">${escapeHtml(state.status?.now || "--")}</p>
      <h1>${escapeHtml(route.title)}</h1>
      <p class="page-description">${escapeHtml(overrideDescription || route.description || "")}</p>
    </div>
  `;
  return page;
}

function buildStats(items) {
  const wrapper = document.createElement("section");
  wrapper.className = "stats-grid route-stats";
  wrapper.innerHTML = items
    .map(
      ([label, value, desc]) => `<article class="stat-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))}</strong>
        <p>${escapeHtml(desc)}</p>
      </article>`
    )
    .join("");
  return wrapper;
}

function buildStockForm() {
  return formPanel("新增自选股", "手动维护自选标的，后续可接入行情和公告数据。", `
    <form class="business-form" data-form="stock">
      <input name="code" required placeholder="代码，如 002428">
      <input name="name" required placeholder="名称，如 云南锗业">
      <select name="market">
        <option>A股</option>
        <option>港股</option>
        <option>美股</option>
      </select>
      <select name="status">
        <option>观察</option>
        <option>重点跟踪</option>
        <option>暂停跟踪</option>
      </select>
      <input name="thesis" placeholder="关注理由">
      <input name="advice" placeholder="投资建议">
      <input name="risk" placeholder="风险提示">
      <input name="watchSignals" placeholder="跟踪信号，用顿号分隔">
      <button type="submit">新增标的</button>
    </form>
  `);
}

function buildStockList() {
  if (!state.stocks.length) return emptyPanel("自选股", "还没有自选标的。");
  return buildCardGrid(
    state.stocks.map((stock) => [
      `${stock.name}（${stock.code}）`,
      `<span class="mini-label">${escapeHtml(stock.market)} · ${escapeHtml(stock.status)}</span>
       <p>${escapeHtml(stock.thesis)}</p>
       <div class="sparkline">${buildSparkline(stock.sparkline)}</div>
       <p><b>建议：</b>${escapeHtml(stock.advice)}</p>
       <p><b>风险：</b>${escapeHtml(stock.risk)}</p>
       <p><b>最近报告：</b>${renderRecentReports(stock)}</p>
       <button class="ghost-button danger" data-action="delete-stock" data-code="${escapeHtml(stock.code)}" type="button">删除标的</button>`,
      true
    ])
  );
}

function buildBrokerFallback() {
  return buildCardGrid([
    [
      "券商账号同步",
      "自动导入券商账号需要券商开放授权接口或用户提供导出文件。当前不做模拟登录和账号密码采集，先降级为手动添加持仓。"
    ]
  ]);
}

function buildPositionForm() {
  return formPanel("新增持仓", "手动录入持仓，后续可以增加券商导出文件导入。", `
    <form class="business-form" data-form="position">
      <input name="code" required placeholder="代码">
      <input name="name" required placeholder="名称">
      <select name="market">
        <option>A股</option>
        <option>港股</option>
        <option>美股</option>
      </select>
      <input name="shares" type="number" min="0" step="1" placeholder="数量">
      <input name="cost" type="number" min="0" step="0.001" placeholder="成本价">
      <input name="reason" placeholder="持仓理由">
      <input name="risk" placeholder="退出条件 / 风险">
      <button type="submit">新增持仓</button>
    </form>
  `);
}

function buildPositionList() {
  if (!state.positions.length) return emptyPanel("持仓列表", "还没有持仓。");
  return buildCardGrid(
    state.positions.map((position) => [
      `${position.name}（${position.code}）`,
      `<span class="mini-label">${escapeHtml(position.market)} · ${position.shares} 股 · 成本 ${position.cost}</span>
       <p><b>理由：</b>${escapeHtml(position.reason)}</p>
       <p><b>风险：</b>${escapeHtml(position.risk)}</p>
       <p><b>最近报告：</b>${renderRecentReports(position)}</p>
       <button class="ghost-button danger" data-action="delete-position" data-id="${escapeHtml(position.id)}" type="button">删除持仓</button>`,
      true
    ])
  );
}

function buildIndexGrid() {
  return buildCardGrid(
    state.indices.map((item) => [
      `${item.region} · ${item.name}`,
      `<span class="mini-label">${escapeHtml(item.code)}</span>
       <p><b>点位：</b>${escapeHtml(item.level)}；<b>涨跌：</b>${escapeHtml(item.change)}</p>
       <p><b>关联基金：</b>${item.relatedEtfs.map(escapeHtml).join("、")}</p>
       <p class="muted-note">实时行情待接入，当前先展示指数和基金映射。</p>`,
      true
    ])
  );
}

function buildDecisionActions() {
  return formPanel("生成每日决策指南", "根据当前市场、自选股、持仓和今日报告生成本地决策指南。", `
    <button class="ghost-button primary-action" data-action="daily-decision" type="button">生成今日决策指南</button>
  `);
}

function buildDecisionList() {
  if (!state.decisions.length) return emptyPanel("决策记录", "还没有决策指南。");
  return buildCardGrid(
    state.decisions.map((decision) => [
      decision.title,
      `<span class="mini-label">${formatLocalTime(decision.createdAt)}</span>
       <p>${escapeHtml(decision.summary)}</p>
       <p><b>行动建议：</b>${escapeHtml(decision.action)}</p>
       <p><b>市场：</b>${escapeHtml(decision.market || "待接入")}</p>`,
      true
    ])
  );
}

function buildAutomationTaskForm() {
  return formPanel("新增自动化任务", "填写任务目标和执行实现，系统会生成一版优化后的执行提示词。", `
    <form class="business-form" data-form="automation-task">
      <input name="name" required placeholder="任务名称">
      <input name="goal" required placeholder="任务目标">
      <input name="implementation" required placeholder="执行实现，例如：每天收集政策新闻并生成报告">
      <input name="schedule" placeholder="执行计划，例如：每个交易日 18:00">
      <button type="submit">新增任务</button>
    </form>
  `);
}

function buildAutomationTaskList() {
  if (!state.automationTasks.length) return emptyPanel("自动化任务", "还没有自动化任务。");
  return buildCardGrid(
    state.automationTasks.map((task) => [
      task.name,
      `<span class="mini-label">${task.enabled ? "运行中" : "暂停"} · ${escapeHtml(task.schedule)}</span>
       <p><b>目标：</b>${escapeHtml(task.goal)}</p>
       <p><b>实现：</b>${escapeHtml(task.implementation)}</p>
       <pre class="prompt-preview">${escapeHtml(task.prompt)}</pre>
       <button class="ghost-button" data-action="toggle-task" data-id="${escapeHtml(task.id)}" type="button">${task.enabled ? "暂停任务" : "开启任务"}</button>`,
      true
    ])
  );
}

function formPanel(title, description, content) {
  const panel = document.createElement("section");
  panel.className = "board route-panel";
  panel.innerHTML = `
    <div class="board-head">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
    </div>
    <div class="route-form-wrap">${content}</div>
  `;
  return panel;
}

function emptyPanel(title, body) {
  const panel = document.createElement("section");
  panel.className = "board route-panel";
  panel.innerHTML = `<div class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>`;
  return panel;
}

function buildCardGrid(items) {
  const panel = document.createElement("section");
  panel.className = "board route-panel";
  panel.innerHTML = `<div class="route-card-grid">${items
    .map(([title, body, trustedHtml]) => `<article class="route-card"><h2>${escapeHtml(title)}</h2>${trustedHtml ? body : `<p>${escapeHtml(body)}</p>`}</article>`)
    .join("")}</div>`;
  return panel;
}

function bindBusinessActions() {
  view.querySelectorAll("form[data-form]").forEach((form) => {
    form.addEventListener("submit", handleBusinessFormSubmit);
  });
  view.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleBusinessAction);
  });
}

async function handleBusinessFormSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setBusy(form, true);
  try {
    if (form.dataset.form === "stock") {
      await postJson("/api/stocks", data);
      toast("自选股已保存");
    } else if (form.dataset.form === "position") {
      await postJson("/api/positions", data);
      toast("持仓已保存");
    } else if (form.dataset.form === "automation-task") {
      await postJson("/api/automation/tasks", data);
      toast("自动化任务已创建");
    }
    form.reset();
    await refresh();
    renderRoute();
  } finally {
    setBusy(form, false);
  }
}

async function handleBusinessAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  setBusy(button, true);
  try {
    if (action === "delete-stock") {
      await deleteJson(`/api/stocks/${encodeURIComponent(button.dataset.code)}`);
      toast("自选股已删除");
    } else if (action === "delete-position") {
      await deleteJson(`/api/positions/${encodeURIComponent(button.dataset.id)}`);
      toast("持仓已删除");
    } else if (action === "daily-decision") {
      await postJson("/api/decisions/daily", {});
      toast("今日决策指南已生成");
    } else if (action === "toggle-task") {
      await postJson(`/api/automation/tasks/${encodeURIComponent(button.dataset.id)}/toggle`, {});
      toast("任务状态已更新");
    }
    await refresh();
    renderRoute();
  } finally {
    setBusy(button, false);
  }
}

function reportsForRoute(routeKey) {
  if (routeKey === "knowledge" || routeKey === "wiki") return state.reports;
  if (routeKey === "candidates") {
    return state.reports.filter((report) => report.status !== "read" || ["industry", "stock"].includes(report.type));
  }
  return state.reports;
}

function buildReportsPanel(title, reports, emptyText) {
  const panel = document.createElement("section");
  panel.className = "board route-panel";
  panel.innerHTML = `
    <div class="board-head">
      <div><h2>${escapeHtml(title)}列表</h2><p>点击报告进入阅读页。</p></div>
      <div class="board-actions">${reportOriginFilterHtml()}</div>
    </div>
    <div class="report-sections"></div>
  `;
  bindReportOriginFilters(panel);
  const container = panel.querySelector(".report-sections");
  const visibleReports = applyReportOriginFilter(reports);
  if (!visibleReports.length) {
    const body = reports.length ? "当前筛选条件下暂无报告。" : "后续生成相关报告后会自动出现在这里。";
    container.innerHTML = `<div class="empty-state"><h2>${escapeHtml(emptyText)}</h2><p>${escapeHtml(body)}</p></div>`;
    return panel;
  }
  for (const report of visibleReports.slice(0, 40)) {
    container.appendChild(buildReportRow(report));
  }
  return panel;
}

async function renderReport(reportId) {
  const report = state.reports.find((item) => item.id === reportId) || (await getReport(reportId));
  if (!report) {
    window.location.hash = "#today";
    toast("没有找到这篇报告");
    return;
  }

  if (report.status !== "read") {
    await postJson(`/api/reports/${encodeURIComponent(report.id)}`, {});
    await refresh();
  }

  const fragment = reportTemplate.content.cloneNode(true);
  view.replaceChildren(fragment);

  const reportUrl = `/reports/${report.file.split("/").map(encodeURIComponent).join("/")}`;
  document.querySelector("#readerMeta").textContent = `${originLabel(report.origin)} · ${report.typeLabel} · ${formatLocalTime(
    report.createdAt
  )} · ${formatArchivePath(report)}`;
  document.querySelector("#readerHeading").textContent = report.title;
  document.querySelector("#openReportLink").href = reportUrl;
  document.querySelector("#reportFrame").src = reportUrl;
}

function renderReportSections() {
  const container = document.querySelector("#reportSections");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const visibleReports = applyReportOriginFilter(state.reports);
  const todayReports = visibleReports.filter((report) => report.localDate === today);
  const olderReports = visibleReports.filter((report) => report.localDate !== today);

  container.replaceChildren();
  if (!visibleReports.length) {
    const hasReports = state.reports.length > 0;
    container.innerHTML = `
      <div class="empty-state">
        <h2>${hasReports ? "当前筛选下暂无报告" : "还没有报告"}</h2>
        <p>${hasReports ? "切换产出方式后可查看其他报告。" : "执行日更或输入一个调研主题，系统会生成第一批网页报告。"}</p>
        ${hasReports ? "" : `<button id="emptyDailyButton" class="ghost-button" type="button">执行日更</button>`}
      </div>
    `;
    document.querySelector("#emptyDailyButton")?.addEventListener("click", handleDailyRun);
    return;
  }

  container.appendChild(buildSection("今日更新", todayReports, false));
  if (olderReports.length) {
    container.appendChild(buildSection("历史更新", olderReports, true));
  }
}

function buildSection(label, reports, old) {
  const section = document.createElement("section");
  const heading = document.createElement("div");
  heading.className = old ? "section-label old" : "section-label";
  heading.textContent = label;
  section.appendChild(heading);

  if (!reports.length) {
    const empty = document.createElement("div");
    empty.className = "report-row";
    empty.innerHTML = `<span class="report-status">无</span><div class="report-title"><a>暂无</a><code>等待新报告写入</code></div>`;
    section.appendChild(empty);
    return section;
  }

  for (const report of reports) {
    section.appendChild(buildReportRow(report));
  }
  return section;
}

function buildReportRow(report) {
  const row = document.createElement("article");
  row.className = "report-row";
  row.innerHTML = `
    <span class="report-status">${report.status === "read" ? "已读" : "新"}</span>
    <div class="report-title">
      <a href="#report/${encodeURIComponent(report.id)}"></a>
      <code></code>
    </div>
    <div class="report-chips">
      <span class="origin-chip" data-origin="${escapeHtml(report.origin || "manual")}"></span>
      <span class="type-chip"></span>
    </div>
  `;
  row.querySelector("a").textContent = report.title;
  row.querySelector("code").textContent = formatArchivePath(report);
  row.querySelector(".origin-chip").textContent = originLabel(report.origin);
  row.querySelector(".type-chip").textContent = report.typeLabel;
  return row;
}

async function handleResearchSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const topicInput = document.querySelector("#topicInput");
  const typeInput = document.querySelector("#researchType");
  const topic = topicInput.value.trim();
  if (!topic) return;

  setBusy(form, true);
  try {
    const { report } = await postJson("/api/research", {
      topic,
      type: typeInput.value
    });
    topicInput.value = "";
    await refresh();
    toast(`已生成：${report.title}`);
    window.location.hash = `#report/${encodeURIComponent(report.id)}`;
  } finally {
    setBusy(form, false);
  }
}

async function handleDailyRun(event) {
  const button = event.currentTarget;
  setBusy(button, true);
  try {
    const result = await postJson("/api/jobs/daily", {});
    await refresh();
    renderRoute();
    toast(result.skipped ? result.reason : `日更完成，生成 ${result.reports.length} 篇报告`);
  } finally {
    setBusy(button, false);
  }
}

async function getReport(reportId) {
  try {
    const payload = await getJson(`/api/reports/${encodeURIComponent(reportId)}`);
    return payload.report;
  } catch {
    return null;
  }
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 ${url} 失败`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `提交 ${url} 失败`);
  return payload;
}

async function deleteJson(url) {
  const response = await fetch(url, { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `删除 ${url} 失败`);
  return payload;
}

function setBusy(element, busy) {
  state.busy = busy;
  element.classList.toggle("is-busy", busy);
}

function setActiveNav() {
  const hash = window.location.hash || "#today";
  document.querySelectorAll(".nav-item").forEach((item) => {
    const shouldActivate =
      item.getAttribute("href") === hash ||
      (hash.startsWith("#report/") && item.getAttribute("href") === "#today");
    item.classList.toggle("active", shouldActivate);
  });
}

function isReportRoute() {
  return (window.location.hash || "").startsWith("#report/");
}

function readReportIdFromHash(hash) {
  const rawId = hash.replace("#report/", "");
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}

function formatLocalTime(isoDate) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(isoDate));
}

function formatArchivePath(report) {
  const filename = (report.wikiPath || report.file || "").split("/").pop() || report.title;
  const category = {
    industry: "产业链研究",
    market: "市场快览",
    stock: "个股跟踪",
    policy: "政策扫描",
    custom: "主题调研"
  }[report.type] || "研究报告";
  return `归档：${category} / ${filename}`;
}

function originLabel(origin) {
  return {
    automation: "自动化产出",
    manual: "手动产出"
  }[origin] || "未标注产出方式";
}

function reportOriginFilterHtml() {
  return `
    <label class="report-filter">
      <span>产出</span>
      <select data-report-origin-filter aria-label="按产出方式筛选报告">
        <option value="all"${state.originFilter === "all" ? " selected" : ""}>全部</option>
        <option value="automation"${state.originFilter === "automation" ? " selected" : ""}>自动化</option>
        <option value="manual"${state.originFilter === "manual" ? " selected" : ""}>手动</option>
      </select>
    </label>
  `;
}

function bindReportOriginFilters(root) {
  root.querySelectorAll("[data-report-origin-filter]").forEach((select) => {
    select.value = state.originFilter;
    select.addEventListener("change", (event) => {
      state.originFilter = event.currentTarget.value;
      renderRoute();
    });
  });
}

function applyReportOriginFilter(reports) {
  if (state.originFilter === "all") return reports;
  return reports.filter((report) => (report.origin || "manual") === state.originFilter);
}

function formatSchedule(schedule) {
  if (!schedule) return "未设置";
  return String(schedule).replace("Asia/Shanghai", "中国标准时间");
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    maximumFractionDigits: 2
  });
}

function countStocksWithReports() {
  return state.stocks.filter((stock) => matchingReports(stock).length).length;
}

function matchingReports(item) {
  const terms = [item.code, item.name].filter(Boolean);
  return state.reports.filter((report) => {
    const text = [report.title, report.topic, report.summary, ...(report.tags || [])].join(" ");
    return terms.some((term) => text.includes(term));
  });
}

function renderRecentReports(item) {
  const reports = matchingReports(item).slice(0, 3);
  if (!reports.length) return "暂无";
  return reports
    .map((report) => `<a href="#report/${encodeURIComponent(report.id)}">${escapeHtml(report.title)}</a>`)
    .join("；");
}

function buildSparkline(values = []) {
  if (!values.length) return "";
  const max = Math.max(...values);
  return values
    .map((value) => {
      const height = Math.max(12, Math.round((value / max) * 42));
      return `<span style="height:${height}px"></span>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 2600);
}
