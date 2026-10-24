import type {
  DashboardService,
  IncidentKind,
  IncidentLifecycle,
  IncidentState,
  NormalizedStatus,
} from "../../domain";

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

const INCIDENT_STATE_LABELS: Record<IncidentState, string> = {
  investigating: "調査中",
  identified: "対応中",
  monitoring: "監視中",
  scheduled: "予定",
  in_progress: "対応中",
  resolved: "復旧済み",
  unknown: "状態不明",
};

const MAINTENANCE_STATE_LABELS: Record<IncidentState, string> = {
  investigating: "実施中",
  identified: "実施中",
  monitoring: "実施中",
  scheduled: "予定",
  in_progress: "実施中",
  resolved: "完了",
  unknown: "状態不明",
};

export function isAbnormal(status: NormalizedStatus): boolean {
  return status !== "operational";
}

export function incidentKindLabel(kind: IncidentKind): string {
  return kind === "maintenance" ? "メンテナンス" : "障害";
}

export function incidentStateLabel(
  kind: IncidentKind,
  state: IncidentState,
  lifecycle: IncidentLifecycle,
): string {
  if (lifecycle === "unverified") {
    return kind === "maintenance" ? "終了未確認" : "復旧未確認";
  }

  if (lifecycle === "resolved") {
    return kind === "maintenance" ? "完了" : "復旧済み";
  }

  const labels = kind === "maintenance" ? MAINTENANCE_STATE_LABELS : INCIDENT_STATE_LABELS;
  return labels[state] ?? "状態不明";
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
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "時刻不明";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
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
