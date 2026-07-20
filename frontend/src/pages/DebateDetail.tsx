import type { DebateReport, DebateView } from "@/hooks/useDebates";

const STAGE_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "辩论进行中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消",
};

const STANCE_BADGE: Record<string, string> = {
  bull: "badge badge-bull",
  bear: "badge badge-bear",
  neutral: "badge badge-neutral",
};
const STANCE_LABEL: Record<string, string> = { bull: "看多", bear: "看空", neutral: "中性" };
const ANALYST_LABEL: Record<string, string> = {
  technical: "技术面",
  fundamental: "基本面",
  macro: "宏观面",
  sentiment: "情绪面",
  bull: "多方",
  bear: "空方",
  judge: "裁判",
  risk: "风控",
};

/** 辩论详情：进行中显示进度，完成后展示四分析师 + 多空 + 裁判 + 风险 + 免责（方案 §8.4）。 */
export function DebateDetail({
  debate,
  onCancel,
  canceling = false,
  onResume,
  resuming = false,
  onRefresh,
  refreshing = false,
}: {
  debate: DebateView;
  onCancel: () => void;
  canceling?: boolean;
  onResume?: () => void;
  resuming?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const running = debate.status === "queued" || debate.status === "running";
  const progress = Math.min(100, Math.max(0, debate.progress));
  const updatedAt = Date.parse(debate.updated_at);
  const stalled = running && Number.isFinite(updatedAt) && Date.now() - updatedAt > 5 * 60_000;

  return (
    <div className="panel debate-detail">
      <div className="debate-detail-head">
        <div>
          <span className={`status-dot status-${debate.status}`} />
          {STAGE_LABEL[debate.status] ?? debate.status}
          {debate.stage && <span className="muted"> · {debate.stage}</span>}
        </div>
        {running && (
          <button className="btn btn-ghost" onClick={onCancel} disabled={canceling}>
            {canceling ? "取消中…" : "取消"}
          </button>
        )}
      </div>

      {running && (
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {stalled && (
        <div className="stalled-debate" role="status">
          <span>进度超过 5 分钟未更新，请确认 Worker 正常运行。</span>
          {onRefresh && (
            <button className="ghost-btn" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "刷新中…" : "刷新状态"}
            </button>
          )}
        </div>
      )}

      {debate.status === "failed" && (
        <div className="debate-failure">
          <div className="login-error" role="alert">
            {debate.error_code === "llm_unavailable"
              ? "未配置 LLM Key，无法辩论。请到设置页配置 BYOK。"
              : (debate.error_message ?? "辩论失败")}
          </div>
          {onResume && (
            <button className="btn btn-ghost" onClick={onResume} disabled={resuming}>
              {resuming ? "重新入队中…" : "从检查点重试"}
            </button>
          )}
        </div>
      )}

      {debate.report && <ReportBody report={debate.report} />}
    </div>
  );
}

function ReportBody({ report }: { report: DebateReport }) {
  const j = report.judge;
  return (
    <div className="report-body fade-up">
      <div className="report-title">
        {report.target.name} <span className="muted">{report.target.code}</span>
      </div>
      <div className="report-context muted">
        周期：{HORIZON_LABEL[report.horizon] ?? report.horizon}
        {report.question && <> · 关注问题：{report.question}</>}
      </div>

      {(report.data_gaps ?? []).length > 0 && (
        <div className="data-gap-banner">
          <span className="badge badge-gap">数据缺口</span>
          {(report.data_gaps ?? []).map((g) => ANALYST_LABEL[g] ?? g).join("、")} 证据缺失，裁判已对该面降权
        </div>
      )}

      {report.evidence_snapshot && <EvidenceSummary snapshot={report.evidence_snapshot} />}

      {/* 四分析师立场 */}
      <div className="analyst-grid">
        {Object.entries(report.analysts).map(([role, v]) => (
          <div key={role} className="analyst-card">
            <div className="analyst-head">
              {ANALYST_LABEL[role] ?? role}
              <span className={STANCE_BADGE[v.stance]}>{STANCE_LABEL[v.stance] ?? v.stance}</span>
              <span className="muted">置信 {v.confidence}</span>
            </div>
            <ul>
              {v.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            {v.data_gaps.length > 0 && <div className="analyst-gap">缺口：{v.data_gaps.join("、")}</div>}
          </div>
        ))}
      </div>

      {/* 多空对辩 */}
      <div className="debate-split">
        <div className="debate-col bull">
          <h4>多方 <span className="muted">置信 {report.debate.bull.confidence}</span></h4>
          <ul>{report.debate.bull.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
          {report.debate.bull.rebuttal && <p className="rebuttal"><strong>反驳：</strong>{report.debate.bull.rebuttal}</p>}
        </div>
        <div className="debate-col bear">
          <h4>空方 <span className="muted">置信 {report.debate.bear.confidence}</span></h4>
          <ul>{report.debate.bear.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
          {report.debate.bear.rebuttal && <p className="rebuttal"><strong>反驳：</strong>{report.debate.bear.rebuttal}</p>}
        </div>
      </div>

      {/* 裁判裁决 */}
      {j && (
        <div className="judge-box">
          <div className="judge-verdict">
            裁判结论：<strong>{j.verdict}</strong> <span className="muted">置信 {j.confidence}</span>
          </div>
          {j.key_disagreements.length > 0 && (
            <div className="judge-row">
              <span className="judge-label">核心分歧</span>
              <ul>{j.key_disagreements.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}
          {j.falsifiers.length > 0 && (
            <div className="judge-row">
              <span className="judge-label">证伪条件</span>
              <ul>{j.falsifiers.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          <div className="judge-row">
            <span className="judge-label">操作建议</span>
            <div>
              {j.action.stance}
              {j.action.trigger && ` · 触发：${j.action.trigger}`}
              {j.action.stop_loss && ` · 风控：${j.action.stop_loss}`}
            </div>
          </div>
        </div>
      )}

      {report.risk_review && report.risk_review.risks.length > 0 && (
        <div className="risk-box">
          <h4>风险审查</h4>
          <ul>{report.risk_review.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      <details className="model-audit">
        <summary>本场模型分配</summary>
        <div className="model-audit-grid">
          {Object.entries(report.model_assignments ?? {}).map(([role, assignment]) => (
            <div key={role}><strong>{ANALYST_LABEL[role] ?? role}</strong><span>{assignment.profile_name} · {assignment.model}</span></div>
          ))}
          {Object.keys(report.model_assignments ?? {}).length === 0 && <span className="muted">无模型分配快照</span>}
        </div>
      </details>

      <p className="disclaimer">{report.disclaimer}</p>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fixed(value: number, suffix = ""): string {
  return `${value.toFixed(2)}${suffix}`;
}

function fundEvidenceItems(evidence: Record<string, unknown>): string[] {
  if (evidence.kind !== "fund_profile") {
    const items: string[] = [];
    const pe = numeric(evidence, "pe");
    const pb = numeric(evidence, "pb");
    const roe = numeric(evidence, "roe");
    const revenueYoy = numeric(evidence, "revenue_yoy");
    const profitYoy = numeric(evidence, "profit_yoy");
    const marketCap = numeric(evidence, "market_cap");
    if (pe !== null) items.push(`PE ${fixed(pe)}`);
    if (pb !== null) items.push(`PB ${fixed(pb)}`);
    if (roe !== null) items.push(`ROE ${fixed(roe, "%")}`);
    if (revenueYoy !== null) items.push(`营收同比 ${fixed(revenueYoy, "%")}`);
    if (profitYoy !== null) items.push(`利润同比 ${fixed(profitYoy, "%")}`);
    if (marketCap !== null) items.push(`市值 ${fixed(marketCap / 100_000_000)} 亿元`);
    return items;
  }

  const items: string[] = [];
  const scale = numeric(evidence, "scale_billion");
  const stockRatio = numeric(evidence, "stock_ratio_pct");
  const cashRatio = numeric(evidence, "cash_ratio_pct");
  const return1m = numeric(evidence, "return_1m_pct");
  const return3m = numeric(evidence, "return_3m_pct");
  const return6m = numeric(evidence, "return_6m_pct");
  const return1y = numeric(evidence, "return_1y_pct");
  if (scale !== null) items.push(`规模 ${fixed(scale)} 亿元`);
  if (stockRatio !== null) items.push(`股票仓位 ${fixed(stockRatio, "%")}`);
  if (cashRatio !== null) items.push(`现金仓位 ${fixed(cashRatio, "%")}`);
  if (return1m !== null) items.push(`近 1 月 ${fixed(return1m, "%")}`);
  if (return3m !== null) items.push(`近 3 月 ${fixed(return3m, "%")}`);
  if (return6m !== null) items.push(`近 6 月 ${fixed(return6m, "%")}`);
  if (return1y !== null) items.push(`近 1 年 ${fixed(return1y, "%")}`);
  const managers = Array.isArray(evidence.managers)
    ? evidence.managers
      .filter(isRecord)
      .map((manager) => String(manager.name ?? "").trim())
      .filter(Boolean)
    : [];
  if (managers.length > 0) items.push(`基金经理 ${managers.join("、")}`);
  return items;
}

function macroEvidenceItems(evidence: Record<string, unknown>): Array<{ label: string; period: string }> {
  return (["cpi", "ppi", "pmi", "gdp", "m2"] as const).flatMap((code) => {
    const observation = evidence[code];
    if (!isRecord(observation)) return [];
    const value = numeric(observation, "value");
    if (value === null) return [];
    return [{
      label: `${code.toUpperCase()} ${fixed(value, String(observation.unit ?? ""))}`,
      period: String(observation.period ?? ""),
    }];
  });
}

function EvidenceSummary({ snapshot }: { snapshot: Record<string, Record<string, unknown>> }) {
  const fundamental = isRecord(snapshot.fundamental) ? snapshot.fundamental : null;
  const macro = isRecord(snapshot.macro) ? snapshot.macro : null;
  if (!fundamental && !macro) return null;
  const fundamentalItems = fundamental ? fundEvidenceItems(fundamental) : [];
  const macroItems = macro ? macroEvidenceItems(macro) : [];
  const fundamentalAsOf = fundamental
    ? String(fundamental.allocation_as_of || fundamental.scale_as_of || fundamental.report_period || "")
    : "";
  const fundamentalLabel = fundamental?.kind === "fund_profile"
    ? "基金画像"
    : fundamental?.kind === "equity_fundamental" ? "财务数据" : "公司估值";

  return (
    <section className="evidence-summary" role="region" aria-label="原始证据">
      <div className="evidence-summary-head">
        <span>原始证据</span>
        <small>报告生成时快照</small>
      </div>
      <div className="evidence-summary-grid">
        {fundamental && (
          <div className="evidence-block">
            <div className="evidence-block-title">
              <strong>基本面</strong>
              <span>{fundamentalLabel}</span>
            </div>
            {fundamentalItems.length > 0 ? (
              <div className="evidence-chip-list">{fundamentalItems.map((item) => <span key={item}>{item}</span>)}</div>
            ) : (
              <p className="evidence-gap">{String(fundamental.data_gap ?? "暂无有效基本面字段")}</p>
            )}
            {fundamentalAsOf && (
              <small className="evidence-asof">截至 {fundamentalAsOf}</small>
            )}
          </div>
        )}
        {macro && (
          <div className="evidence-block">
            <div className="evidence-block-title"><strong>宏观面</strong><span>东财宏观</span></div>
            {macroItems.length > 0 ? (
              <div className="macro-evidence-list">
                {macroItems.map((item) => <span key={item.label}><strong>{item.label}</strong><small>{item.period}</small></span>)}
              </div>
            ) : (
              <p className="evidence-gap">{String(macro.data_gap ?? "暂无有效宏观指标")}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const HORIZON_LABEL: Record<string, string> = {
  short: "短线（1-5 日）",
  swing: "波段（2-8 周）",
  long: "中长线（3-12 月）",
};
