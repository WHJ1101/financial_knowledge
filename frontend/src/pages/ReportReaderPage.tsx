import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/api/client";
import {
  useDeleteReport,
  useMarkRead,
  useReport,
  useToggleArchive,
  useToggleStar,
} from "@/hooks/useReports";
import { GlassButton, GlassPanel } from "@/components/LiquidGlass";
import { AppDialog } from "@/components/mobile/AppDialog";
import { BottomSheet } from "@/components/mobile/BottomSheet";
import { applyReportReaderTheme, type ReportReaderTheme } from "@/styles/reportFrameTheme";

interface AssetLink {
  id: string;
  assetCode: string;
  assetName: string;
  assetMarket: string;
  relation: string;
}

function resolvedReaderTheme(): ReportReaderTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function buildReaderToc(headings: HTMLElement[]) {
  let previousKey = "";
  return headings.flatMap((heading, index) => {
    const label = heading.textContent?.trim() || `第 ${index + 1} 节`;
    const level = Number(heading.tagName.slice(1));
    const key = `${level}:${label.replace(/\s+/g, " ")}`;
    if (key === previousKey) return [];
    previousKey = key;
    const id = heading.id || `reader-heading-${index + 1}`;
    heading.id = id;
    return [{ id, label, level }];
  });
}

export function ReportReaderPage() {
  const { reportId = "" } = useParams();
  const navigate = useNavigate();
  const metadata = useReport(reportId);
  const markRead = useMarkRead();
  const toggleStar = useToggleStar();
  const toggleArchive = useToggleArchive();
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
  const [readerTheme, setReaderTheme] = useState<ReportReaderTheme>(resolvedReaderTheme);
  const [toc, setToc] = useState<Array<{ id: string; label: string; level: number }>>([]);
  const [showToc, setShowToc] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const themedHtml = useMemo(
    () => (html === null ? null : applyReportReaderTheme(html, readerTheme)),
    [html, readerTheme],
  );

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setReaderTheme(resolvedReaderTheme());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

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

  const onFrameLoad = () => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) return;
    setFrameHeight(Math.max(640, frameDocument.documentElement.scrollHeight + 8));
    const headings = [...frameDocument.querySelectorAll<HTMLElement>("h1, h2, h3")];
    setToc(buildReaderToc(headings));
  };

  const goToHeading = (id: string) => {
    const frame = iframeRef.current;
    const heading = frame?.contentDocument?.getElementById(id);
    if (!frame || !heading) return;
    const top = frame.offsetTop + heading.offsetTop - 118;
    const scrollRoot = frame.closest(".app-main");
    if (scrollRoot && scrollRoot.scrollHeight > scrollRoot.clientHeight) {
      scrollRoot.scrollTo({ top, behavior: "smooth" });
    } else {
      window.scrollTo({ top, behavior: "smooth" });
    }
    setShowToc(false);
  };

  return (
    <div className="page fade-up reader-page">
      <header className="reader-head">
        <Link to="/knowledge" className="back-link">← 返回知识库</Link>
        <div className="reader-actions">
          {toc.length > 0 && <GlassButton tone="utility" onClick={() => setShowToc(true)}>目录</GlassButton>}
          {metadata.data && (
            <>
              <GlassButton
                tone="utility"
                disabled={toggleStar.isPending}
                onClick={() => toggleStar.mutate(reportId, { onSuccess: () => metadata.refetch() })}
              >
                {metadata.data.starred ? "取消星标" : "星标"}
              </GlassButton>
              <GlassButton
                tone="utility"
                disabled={toggleArchive.isPending}
                onClick={() => toggleArchive.mutate(reportId, { onSuccess: () => metadata.refetch() })}
              >
                {metadata.data.archived ? "移出归档" : "归档"}
              </GlassButton>
            </>
          )}
          {metadata.data?.is_owner && (
            <>
              <GlassButton tone="utility" onClick={() => setEditingAssets((value) => !value)}>编辑关联标的</GlassButton>
              <GlassButton
                tone="danger"
                disabled={removeReport.isPending}
                onClick={() => setShowDeleteConfirm(true)}
              >
                {removeReport.isPending ? "删除中…" : "删除报告"}
              </GlassButton>
            </>
          )}
        </div>
      </header>

      {metadata.data && (
        <div className="reader-meta">
          <h1>{metadata.data.title}</h1>
          <p className="muted">{metadata.data.topic}</p>
          {metadata.data.imported_at && (
            <p className="muted reader-provenance">
              导入来源：{metadata.data.source || "未知"} · 导入时间：
              {new Date(metadata.data.imported_at).toLocaleString("zh-CN")} · 可见性：
              {metadata.data.visibility === "shared" ? "共享" : "私有"}
            </p>
          )}
        </div>
      )}

      {metadata.isLoading && <p className="muted pad">加载报告信息…</p>}
      {actionError && <div className="login-error" role="alert">{actionError}</div>}

      {(assets.length > 0 || editingAssets) && (
        <GlassPanel as="section" tone="control" className="reader-asset-panel">
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
              <GlassButton tone="primary" refraction type="submit" disabled={!assetForm.assetCode || assetPending}>{assetPending ? "保存中…" : "添加"}</GlassButton>
            </form>
          )}
          {assetError && <div className="login-error" role="alert">{assetError}</div>}
        </GlassPanel>
      )}

      {(error || metadata.isError) && (
        <div className="panel error-state" role="alert">
          {error || "报告元数据加载失败"}
          <GlassButton tone="text" size="sm" onClick={() => {
            metadata.refetch();
            setLoadAttempt((value) => value + 1);
          }}>重试</GlassButton>
        </div>
      )}
      {!error && html === null && !metadata.isError && <p className="muted pad">加载报告正文…</p>}
      {themedHtml !== null && (
        <iframe
          ref={iframeRef}
          className="reader-frame"
          style={{ height: frameHeight }}
          title="报告正文"
          sandbox="allow-same-origin"
          srcDoc={themedHtml}
          onLoad={onFrameLoad}
        />
      )}
      <BottomSheet
        open={showToc}
        title="报告目录"
        onClose={() => setShowToc(false)}
        height="medium"
        showOnDesktop
      >
        <nav className="reader-toc" aria-label="报告目录">
          {toc.map((item) => (
            <button
              key={item.id}
              className={`reader-toc-level-${item.level}`}
              onClick={() => goToHeading(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </BottomSheet>
      <AppDialog
        open={showDeleteConfirm}
        title="删除报告"
        description={<p>确认删除「{metadata.data?.title}」？正文文件、关联标的和个人状态将一并删除。</p>}
        confirmLabel="确认删除"
        tone="danger"
        pending={removeReport.isPending}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => removeReport.mutate(reportId, {
          onSuccess: () => navigate("/knowledge", { replace: true }),
          onError: (reason) => {
            setShowDeleteConfirm(false);
            setActionError(reason instanceof ApiError ? reason.detail : "报告删除失败");
          },
        })}
      />
    </div>
  );
}
