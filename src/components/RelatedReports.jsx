import { useEffect, useState } from "preact/hooks";

import { get } from "../api.js";

export function RelatedReports({ code }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) { setLinks([]); return; }
    let cancelled = false;
    setLoading(true);
    get("/api/assets/" + encodeURIComponent(code) + "/reports")
      .then(data => { if (!cancelled) setLinks(data.reports || []); })
      .catch(() => { if (!cancelled) setLinks([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <section class="related-reports">
      <div class="related-head">
        <span>相关报告</span>
        {loading && <em>加载中</em>}
      </div>
      {links.length ? (
        <div class="related-report-list">
          {links.slice(0, 6).map(link => (
            <a key={link.id} href={"#report/" + encodeURIComponent(link.report.id)} class="related-report-item">
              <strong>{link.report.title}</strong>
              <span>{link.report.typeLabel || "报告"} · {link.report.localDate}</span>
            </a>
          ))}
        </div>
      ) : (
        <p class="related-empty">{loading ? "正在读取关联报告" : "暂无关联报告"}</p>
      )}
    </section>
  );
}
