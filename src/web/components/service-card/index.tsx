import type { DashboardService, NormalizedStatus } from "../../../domain";
import {
  formatDateTime,
  relativeTime,
  STATUS_LABELS,
} from "../../presentation/status-presentation";
import { ExternalIcon, WarningIcon } from "../icons";
import { assignIncidents } from "./assign-incidents";
import { ComponentList } from "./component-list";
import { IncidentList } from "./incident-list";
import { ServiceIcon } from "./service-icon";
import { statusColors } from "./status-colors";

const statusBorders: Record<NormalizedStatus, string> = {
  operational: "border-t-line-strong",
  degraded_performance: "border-t-degraded",
  partial_outage: "border-t-partial",
  major_outage: "border-t-outage",
  under_maintenance: "border-t-maintenance",
  unknown: "border-t-unknown",
};

export default function ServiceCard({ service }: { service: DashboardService }) {
  const { assigned, unassigned } = assignIncidents(service);

  return (
    <li
      className={`min-w-0 rounded-lg border border-line border-t-4 bg-surface px-5 pt-4 pb-2.5 shadow-sm max-sm:px-3 max-sm:pt-3 max-sm:pb-2 ${statusBorders[service.status]}`}
      id={`service-details-${service.id}`}
      aria-label={`${service.name}のサービス状況`}
    >
      <header className="flex items-center gap-2 border-b border-line pb-3 max-sm:items-start">
        <ServiceIcon service={service} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-x-2.5 gap-y-2 max-sm:items-start">
          <h2 className="m-0 min-w-0 text-lg font-bold leading-snug max-sm:text-base">
            <a
              className="inline-flex items-baseline gap-1 text-ink underline-offset-2 hover:underline focus-visible:underline"
              href={service.statusPageUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`${service.name}の公式ステータスページを新しいタブで開く`}
            >
              {service.name}
              <ExternalIcon />
            </a>
          </h2>
          <span
            className={`inline-flex min-h-7 items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-xs font-bold ${statusColors[service.status]}`}
            aria-label={`公式全体ステータス: ${STATUS_LABELS[service.status]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {STATUS_LABELS[service.status]}
          </span>
        </div>
      </header>

      {service.status !== "operational" && service.summary && (
        <p className="mt-2 mb-0 [overflow-wrap:anywhere] text-xs leading-relaxed text-muted">
          {service.summary}
        </p>
      )}

      {service.hasFetchError && (
        <output className="mt-4 flex items-center gap-2 text-xs leading-normal text-warning">
          <WarningIcon />
          このサービスの最新情報を取得できません。状態は前回取得時のものです。
        </output>
      )}
      {service.isStale && !service.hasFetchError && (
        <output className="mt-4 flex items-center gap-2 text-xs leading-normal text-stale">
          <WarningIcon />
          {service.lastSuccessAt
            ? `前回の情報更新から${relativeTime(service.lastSuccessAt)}経過しています。最新の状態と異なる可能性があります。`
            : "最新情報をまだ取得できていません。公式ステータスページで状態をご確認ください。"}
        </output>
      )}

      <ComponentList
        serviceId={service.id}
        serviceName={service.name}
        components={service.components}
        assignedIncidents={assigned}
      />

      {unassigned.length > 0 && (
        <section className="mt-3" aria-label={`${service.name}の障害・メンテナンス情報`}>
          <h3 className="mt-0 mb-1 text-xs font-semibold text-muted">
            その他の障害・メンテナンス情報
          </h3>
          <IncidentList incidents={unassigned} />
        </section>
      )}

      <footer className="mt-2 flex justify-end text-xs tabular-nums text-quiet">
        {service.lastSuccessAt ? (
          <span>
            最終取得{" "}
            <time dateTime={service.lastSuccessAt}>{formatDateTime(service.lastSuccessAt)}</time>
          </span>
        ) : (
          <span>最終取得時刻なし</span>
        )}
      </footer>
    </li>
  );
}
