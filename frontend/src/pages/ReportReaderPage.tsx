import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/api/client";
import { useDeleteReport, useMarkRead, useReport } from "@/hooks/useReports";
import { applyReportReaderTheme } from "@/styles/reportFrameTheme";

interface AssetLink {
  id: string;
  assetCode: string;
  assetName: string;
  assetMarket: string;
  relation: string;
}

export function ReportReaderPage() {
  const { reportId = "" } = useParams();
  const navigate = useNavigate();
  const metadata = useReport(reportId);
  const markRead = useMarkRead();
  const removeReport = useDeleteReport();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetLink[]>([]);
  const [assetForm, setAssetForm] = useState({ assetCode: "", assetName: "", assetMarket: "A股", relation: "related" });
  const [editingAssets, setEditingAssets] = useState(false);
  const [assetPending, setAssetPending] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [frameHeight, setFrameHeight] = useState(900);
  const themedHtml = useMemo(() => (html === null ? null : applyReportReaderTheme(html)), [html]);

  const refreshAssets = () => {
    setAssetError(null);
    return api
      .get<{ assets: AssetLink[] }>(`/reports/${encodeURIComponent(reportId)}/assets`)
      .then((result) => setAssets(result.assets));
  };

  useEffect(() => {
    let alive = true;
    setHtml(null);
    setError(null);
    setActionError(null);
    fetch(`/api/v1/reports/${encodeURIComponent(reportId)}/content`, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "报告正文缺失或无权访问" : `加载失败（${response.status}）`);
        return response.text();
      })
      .then((text) => alive && setHtml(text))
      .catch((reason) => alive && setError(reason.message));
    refreshAssets().catch(() => alive && setAssetError("关联标的加载失败"));
    markRead.mutate(reportId, {
      onError: (reason) => setActionError(reason instanceof ApiError ? reason.detail : "已读状态保存失败"),
    });
    return () => { alive = false; };
    // reportId 变化或用户主动重试时重新加载，mutation 引用不参与触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, loadAttempt]);

  const addAsset = async (event: React.FormEvent) => {
    event.preventDefault();
    setAssetPending(true);
    setAssetError(null);
    try {
      await api.post(`/reports/${encodeURIComponent(reportId)}/assets`, assetForm);
      await refreshAssets();
      setAssetForm({ assetCode: "", assetName: "", assetMarket: "A股", relation: "related" });
    } catch (reason) {
      setAssetError(reason instanceof ApiError ? reason.detail : "关联标的保存失败");
    } finally {
      setAssetPending(false);
    }
  };

  const deleteAsset = async (id: string) => {
    setAssetPending(true);
    setAssetError(null);
    try {
      await api.del(`/report-asset-links/${id}`);
      await refreshAssets();
    } catch (reason) {
      setAssetError(reason instanceof ApiError ? reason.detail : "关联标的删除失败");
    } finally {
      setAssetPending(false);
    }
  };

  const resizeFrame = () => {
    const document = iframeRef.current?.contentDocument;
    if (document) setFrameHeight(Math.max(640, document.documentElement.scrollHeight + 8));
  };

  return (
    <div className="page fade-up reader-page">
      <header className="reader-head">
        <Link to="/knowledge" className="back-link">← 返回知识库</Link>
        <div className="reader-actions">
          {metadata.data?.is_owner && (
            <>
              <button className="ghost-btn" onClick={() => setEditingAssets((value) => !value)}>编辑关联标的</button>
              <button
                className="ghost-btn danger"
                disabled={removeReport.isPending}
                onClick={() => window.confirm(`确认删除「${metadata.data?.title}」？`) && removeReport.mutate(reportId, {
                  onSuccess: () => navigate("/knowledge", { replace: true }),
                  onError: (reason) => setActionError(reason instanceof ApiError ? reason.detail : "报告删除失败"),
                })}
              >
                {removeReport.isPending ? "删除中…" : "删除报告"}
              </button>
            </>
          )}
        </div>
      </header>

      {metadata.data && (
        <div className="reader-meta">
          <h1>{metadata.data.title}</h1>
          <p className="muted">{metadata.data.topic}</p>
        </div>
      )}

      {metadata.isLoading && <p className="muted pad">加载报告信息…</p>}
      {actionError && <div className="login-error" role="alert">{actionError}</div>}

      {(assets.length > 0 || editingAssets) && (
        <section className="panel reader-asset-panel">
          <div className="reader-assets">
            <span className="muted">关联标的</span>
            {assets.map((asset) => (
              <span key={asset.id} className="asset-chip">
                {asset.assetName || asset.assetCode}
                {editingAssets && (
                  <button
                    aria-label={`删除 ${asset.assetName || asset.assetCode}`}
                    disabled={assetPending}
                    onClick={() => deleteAsset(asset.id)}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {editingAssets && metadata.data?.is_owner && (
            <form className="reader-asset-form" onSubmit={addAsset}>
              <input aria-label="证券代码" placeholder="证券代码" value={assetForm.assetCode} onChange={(event) => setAssetForm({ ...assetForm, assetCode: event.target.value })} />
              <input aria-label="证券名称" placeholder="名称" value={assetForm.assetName} onChange={(event) => setAssetForm({ ...assetForm, assetName: event.target.value })} />
              <input aria-label="市场" placeholder="市场" value={assetForm.assetMarket} onChange={(event) => setAssetForm({ ...assetForm, assetMarket: event.target.value })} />
              <select aria-label="关联关系" value={assetForm.relation} onChange={(event) => setAssetForm({ ...assetForm, relation: event.target.value })}>
                <option value="related">相关</option><option value="subject">研究主体</option><option value="competitor">竞品</option>
              </select>
              <button className="btn" disabled={!assetForm.assetCode || assetPending}>{assetPending ? "保存中…" : "添加"}</button>
            </form>
          )}
          {assetError && <div className="login-error" role="alert">{assetError}</div>}
        </section>
      )}

      {(error || metadata.isError) && (
        <div className="panel error-state" role="alert">
          {error || "报告元数据加载失败"}
          <button onClick={() => {
            metadata.refetch();
            setLoadAttempt((value) => value + 1);
          }}>重试</button>
        </div>
      )}
      {!error && html === null && !metadata.isError && <p className="muted pad">加载报告正文…</p>}
      {themedHtml !== null && (
        <iframe
          ref={iframeRef}
          className="reader-frame"
          style={{ height: frameHeight }}
          title="报告正文"
          sandbox="allow-same-origin allow-popups"
          srcDoc={themedHtml}
          onLoad={resizeFrame}
        />
      )}
    </div>
  );
}
