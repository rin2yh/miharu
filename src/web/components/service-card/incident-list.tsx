import type { DashboardIncident, NormalizedStatus } from "../../../domain";
import {
  formatDateTime,
  incidentCategoryLabel,
  incidentStateLabel,
  STATUS_LABELS,
} from "../../presentation/status-presentation";
import { ExternalIcon } from "../icons";

function incidentCategoryColor(category: DashboardIncident["displayCategory"]): string {
  switch (category) {
    case "maintenance":
      return "bg-maintenance-bg text-maintenance";
    case "outage":
      return "bg-outage-bg text-outage";
    default:
      return "bg-unknown-bg text-unknown";
  }
}

function incidentStateColor(incident: DashboardIncident): string {
  if (incident.state === "unknown" || incident.lifecycle === "unverified") {
    return "bg-unknown-bg text-unknown";
  }
  if (incident.state === "resolved") {
    return "bg-healthy-bg text-healthy";
  }
  switch (incident.state) {
    case "monitoring":
      return "bg-degraded-bg text-degraded";
    default:
      return "bg-partial-bg text-partial";
  }
}

const incidentImpactColors: Record<NormalizedStatus, string> = {
  operational: "bg-unknown-bg text-unknown",
  degraded_performance: "bg-degraded-bg text-degraded",
  partial_outage: "bg-partial-bg text-partial",
  major_outage: "bg-outage-bg text-outage",
  under_maintenance: "bg-maintenance-bg text-maintenance",
  unknown: "bg-unknown-bg text-unknown",
};

export function IncidentList({
  incidents,
  nested = false,
}: {
  incidents: DashboardIncident[];
  nested?: boolean;
}) {
  return (
    <ul className={`m-0 block list-none border-t border-line p-0 ${nested ? "mb-2 ml-5" : ""}`}>
      {incidents.map((incident) => (
        <li
          className="border-b border-line last:border-b-0"
          key={incident.id}
          aria-label={incident.title}
        >
          <details className="group">
            <summary className="relative grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3.5 gap-y-2 py-2 pr-1 pl-5 text-ink max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:gap-x-2.5 max-sm:gap-y-1.5">
              <span
                className="absolute left-0.5 text-lg leading-none text-quiet transition-transform duration-150 group-open:rotate-90"
                aria-hidden="true"
              >
                ›
              </span>
              <span className="min-w-0 text-xs font-semibold leading-normal wrap-anywhere max-sm:col-span-full">
                {incident.title}
              </span>
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex min-h-5 items-center rounded-xs px-1.5 py-0.5 text-xs font-bold ${incidentCategoryColor(incident.displayCategory)}`}
                >
                  {incidentCategoryLabel(incident.displayCategory)}
                </span>
                <span
                  className={`inline-flex min-h-5 items-center rounded-xs px-1.5 py-0.5 text-xs font-semibold ${incidentStateColor(incident)}`}
                >
                  {incidentStateLabel(incident.kind, incident.state, incident.lifecycle)}
                </span>
              </span>
              <span className="whitespace-nowrap text-xs tabular-nums text-quiet">
                更新{" "}
                {incident.officialUpdatedAt ? (
                  <time dateTime={incident.officialUpdatedAt}>
                    {formatDateTime(incident.officialUpdatedAt)}
                  </time>
                ) : (
                  "時刻不明"
                )}
              </span>
              <span className="whitespace-nowrap text-xs text-muted max-sm:justify-self-end">
                詳細
              </span>
            </summary>
            <div className="pr-1 pb-3 pl-5">
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={`inline-flex min-h-5 items-center rounded-xs px-1.5 py-0.5 text-xs font-bold ${incidentCategoryColor(incident.displayCategory)}`}
                >
                  {incident.displayCategory === "outage"
                    ? "障害情報"
                    : incidentCategoryLabel(incident.displayCategory)}
                </span>
                {incident.severityStatus && (
                  <span
                    className={`inline-flex min-h-5 items-center rounded-xs px-1.5 py-0.5 text-xs font-bold ${incidentImpactColors[incident.severityStatus]}`}
                  >
                    {`${incident.displayCategory === "maintenance" ? "メンテナンス状態" : incident.displayCategory === "outage" ? "障害の重要度" : "公式の影響度"}: ${STATUS_LABELS[incident.severityStatus]}`}
                  </span>
                )}
              </div>
              {incident.lifecycle === "unverified" && (
                <p className="mt-1.5 mb-0 max-w-3xl text-xs leading-relaxed text-muted">
                  最後に確認した公式状態を表示しています。現在の状態を再確認できていません。
                </p>
              )}
              {incident.body && (
                <p className="mt-1.5 mb-0 max-h-48 max-w-3xl overflow-auto overscroll-contain whitespace-pre-wrap text-xs leading-relaxed text-incident-body wrap-anywhere max-sm:max-h-28">
                  {incident.body}
                </p>
              )}
              {incident.components.length > 0 && (
                <p
                  className="mt-2 mb-0 text-xs leading-normal text-muted"
                  aria-label="公式の影響対象"
                >
                  影響対象: {incident.components.join("、")}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-xs tabular-nums text-quiet">
                <span>
                  公式発生{" "}
                  {incident.officialCreatedAt ? (
                    <time dateTime={incident.officialCreatedAt}>
                      {formatDateTime(incident.officialCreatedAt)}
                    </time>
                  ) : (
                    "時刻不明"
                  )}
                </span>
              </div>
              {incident.url && (
                <a
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-healthy decoration-healthy/50 underline-offset-2 hover:underline"
                  href={incident.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  公式情報を見る
                  <ExternalIcon />
                </a>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
