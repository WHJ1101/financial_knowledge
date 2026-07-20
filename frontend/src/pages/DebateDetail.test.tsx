import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DebateDetail } from "@/pages/DebateDetail";
import type { DebateView } from "@/hooks/useDebates";

function debate(status: DebateView["status"] = "done"): DebateView {
  return {
    id: "d1",
    instrument_id: "i1",
    instrument_name: "江波龙",
    instrument_code: "301308",
    horizon: "long",
    question: "估值是否合理？",
    status,
    progress: status === "running" ? 72 : 100,
    stage: status === "running" ? "交叉反驳" : "完成",
    verdict: status === "done" ? "偏多" : null,
    confidence: status === "done" ? 72 : null,
    error_code: null,
    error_message: null,
    attempt: 1,
    model_assignments: {},
    created_at: "2026-07-16T08:00:00Z",
    started_at: "2026-07-16T08:00:01Z",
    finished_at: status === "done" ? "2026-07-16T08:01:00Z" : null,
    updated_at: new Date().toISOString(),
    report: status === "done" ? {
      target: { name: "江波龙", code: "301308", market: "创业板" },
      horizon: "long",
      question: "估值是否合理？",
      evidence_snapshot: {
        fundamental: {
          kind: "fund_profile",
          name: "永赢先锋半导体智选混合发起A",
          scale_billion: 14.45,
          scale_as_of: "2026-03-31",
          stock_ratio_pct: 67.44,
          return_1m_pct: -11.5,
          managers: [{ name: "张海啸" }],
          source: "eastmoney_fund",
        },
        macro: {
          cpi: { period: "2026年06月份", value: 1.0, unit: "%" },
          pmi: { period: "2026年06月份", value: 50.3, unit: "点" },
          gdp: { period: "2026年第1季度", value: 5.0, unit: "%" },
        },
      },
      analysts: {
        technical: { stance: "bull", points: ["均线多头"], confidence: 80, data_gaps: [] },
        fundamental: { stance: "neutral", points: ["估值偏高"], confidence: 60, data_gaps: [] },
        macro: { stance: "neutral", points: [], confidence: 30, data_gaps: ["宏观缺口"] },
        sentiment: { stance: "bear", points: ["情绪拥挤"], confidence: 55, data_gaps: [] },
      },
      debate: {
        bull: { points: ["需求增长"], rebuttal: "回应估值质疑", confidence: 68, data_gaps: [] },
        bear: { points: ["估值过高"], rebuttal: "回应增长预期", confidence: 62, data_gaps: [] },
      },
      judge: {
        verdict: "偏多",
        confidence: 72,
        key_disagreements: ["增长与估值"],
        bull_case: "增长",
        bear_case: "估值",
        falsifiers: ["需求转弱"],
        action: { stance: "持有", trigger: "回踩确认", stop_loss: "跌破 MA20" },
        data_caveats: [],
      },
      risk_review: { risks: ["回撤风险"], overall: "中性偏多" },
      data_gaps: ["macro"],
      disclaimer: "非投资建议",
      model_assignments: {
        technical: { profile_name: "分析组", model: "model-a", provider_host: "openrouter.ai" },
        judge: { profile_name: "裁判组", model: "model-b", provider_host: "openrouter.ai" },
      },
    } : null,
  };
}

test("完整展示周期、真实反驳、裁判、风险和模型分配", () => {
  render(<DebateDetail debate={debate()} onCancel={() => undefined} />);
  expect(screen.getByText(/中长线/)).toHaveTextContent("估值是否合理");
  expect(screen.getByText("回应估值质疑")).toBeInTheDocument();
  expect(screen.getByText("回应增长预期")).toBeInTheDocument();
  expect(screen.getByText(/裁判结论/)).toHaveTextContent("偏多");
  expect(screen.getByText("回撤风险")).toBeInTheDocument();
  expect(screen.getByText(/裁判组/)).toHaveTextContent("model-b");
  expect(screen.getByRole("region", { name: "原始证据" })).toHaveTextContent("规模 14.45 亿元");
  expect(screen.getByRole("region", { name: "原始证据" })).toHaveTextContent("近 1 月 -11.50%");
  expect(screen.getByRole("region", { name: "原始证据" })).toHaveTextContent("CPI 1.00%");
  expect(screen.getByRole("region", { name: "原始证据" })).toHaveTextContent("PMI 50.30点");
});

test("运行中显示进度并允许取消", async () => {
  const onCancel = vi.fn();
  const { container } = render(<DebateDetail debate={debate("running")} onCancel={onCancel} />);
  expect(container.querySelector<HTMLElement>(".progress-fill")?.style.width).toBe("72%");
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

test("失败时显示错误并允许从检查点重试", async () => {
  const onResume = vi.fn();
  const failed = debate("failed");
  failed.error_message = "provider timeout";
  render(<DebateDetail debate={failed} onCancel={() => undefined} onResume={onResume} />);

  expect(screen.getByRole("alert")).toHaveTextContent("provider timeout");
  await userEvent.click(screen.getByRole("button", { name: "从检查点重试" }));
  expect(onResume).toHaveBeenCalledOnce();
});

test("长时间无进度时提示 Worker 并允许手动刷新", async () => {
  const onRefresh = vi.fn();
  const stalled = debate("queued");
  stalled.updated_at = new Date(Date.now() - 6 * 60_000).toISOString();
  render(<DebateDetail debate={stalled} onCancel={() => undefined} onRefresh={onRefresh} />);

  expect(screen.getByRole("status")).toHaveTextContent("请确认 Worker 正常运行");
  await userEvent.click(screen.getByRole("button", { name: "刷新状态" }));
  expect(onRefresh).toHaveBeenCalledOnce();
});
