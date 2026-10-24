import type { DashboardIncident, DashboardService, NormalizedStatus } from "../../domain";

export const STATUS_LABELS: Record<NormalizedStatus, string> = {
  operational: "正常",
  degraded_performance: "性能低下",
  partial_outage: "部分障害",
  major_outage: "全面障害",
  under_maintenance: "メンテナンス",
  unknown: "状態不明",
};

export const STATUS_RANK: Record<NormalizedStatus, number> = {
  operational: 0,
  unknown: 1,
  under_maintenance: 2,
  degraded_performance: 3,
  partial_outage: 4,
  major_outage: 5,
};

export function isAbnormal(status: NormalizedStatus): boolean {
  return status !== "operational";
}

export function incidentStateLabel(
  state: DashboardIncident["state"],
  lifecycle: DashboardIncident["lifecycle"],
): string {
  if (lifecycle === "unverified") return "確認不能";
  switch (state) {
    case "investigating":
      return "調査中";
    case "identified":
      return "原因特定";
    case "monitoring":
      return "復旧確認中";
    case "scheduled":
      return "予定・実施中";
    case "resolved":
      return "復旧";
    default:
      return "状態不明";
  }
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "時刻不明";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(value: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (elapsedMinutes < 1) return "1分未満";
  if (elapsedMinutes < 60) return `${elapsedMinutes}分`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}時間`;
  return `${Math.floor(hours / 24)}日`;
}

export function servicePriority(service: DashboardService): number {
  return Math.max(
    priorityRank(service.status),
    ...service.components.map((component) => priorityRank(component.status)),
    ...service.incidents.map((incident) =>
      incident.severityStatus ? priorityRank(incident.severityStatus) : 0,
    ),
  );
}

function priorityRank(status: NormalizedStatus): number {
  return status === "operational" || status === "unknown" ? 0 : STATUS_RANK[status];
}
