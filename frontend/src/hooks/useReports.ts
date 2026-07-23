/** 报告/知识库 hooks（方案 §8.3/§4.3）：可见性 shared|owner；个人态标星/归档/已读。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface ReportView {
  id: string;
  visibility: "private" | "shared";
  title: string;
  topic: string;
  type: string;
  type_label: string | null;
  summary: string | null;
  origin: string | null;
  local_date: string | null;
  tags: string[];
  content_status: string;
  created_at: string;
  is_owner: boolean;
  starred: boolean;
  archived: boolean;
  read: boolean;
}

export function useReports() {
  return useQuery({ queryKey: ["reports"], queryFn: () => api.get<ReportView[]>("/reports") });
}

export function useReport(id: string) {
  return useQuery({
    queryKey: ["report", id],
    queryFn: () => api.get<ReportView>(`/reports/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
}

function useReportAction(action: "read" | "star" | "archive") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/reports/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}

export const useMarkRead = () => useReportAction("read");
export const useToggleStar = () => useReportAction("star");
export const useToggleArchive = () => useReportAction("archive");

/** 删除报告（仅 owner=self；文件 + DB + 关联）。 */
export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/reports/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}

/** 切换报告可见性（仅 owner）。 */
export function useToggleVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: "private" | "shared" }) =>
      api.patch(`/reports/${encodeURIComponent(id)}/visibility`, { visibility }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}
