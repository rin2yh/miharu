import { useState } from "react";
import { siClaude, siCloudflare, siGithub, siNotion } from "simple-icons";
import { INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS } from "../../domain";
import type {
  DashboardIncident,
  DashboardComponent,
  DashboardService,
  NormalizedStatus,
} from "../../domain";
import { ExternalIcon, WarningIcon } from "./icons";
import {
  formatDateTime,
  incidentStateLabel,
  isAbnormal,
  relativeTime,
  STATUS_LABELS,
  STATUS_RANK,
} from "../presentation/status-presentation";

type ServiceIcon = { path: string; hex?: string };

const chatgptIcon: ServiceIcon = {
  // OpenAI's official monoblossom mark, scaled from a 721x721 viewBox to 24x24.
  // https://cdn.openai.com/brand/OpenAI-Logos-2025.zip
  path: `
    M 10.127467 9.806746 V 8.28942 C 10.127467 8.161631 10.175434 8.065764 10.287179 8.001953 L 13.337875 6.24506 C 13.753132 6.005492 14.248277 5.893748 14.759301 5.893748 C 16.675872 5.893748 17.88982 7.379151 17.88982 8.960288 C 17.88982 9.072067 17.88982 9.199856 17.873809 9.327645 L 14.711368 7.474885 C 14.519734 7.36314 14.328 7.36314 14.136366 7.474885 L 10.127467 9.806746 Z
    M 17.250874 15.716338 V 12.090674 C 17.250874 11.867018 17.154974 11.707307 16.963373 11.595528 L 12.954474 9.263667 L 14.264155 8.512943 C 14.375933 8.449132 14.4718 8.449132 14.583578 8.512943 L 17.634241 10.269836 C 18.512755 10.780993 19.103634 11.867018 19.103634 12.921087 C 19.103634 14.134902 18.384965 15.252982 17.250874 15.716205 V 15.716338 Z
    M 9.185143 12.522008 L 7.875462 11.755406 C 7.763717 11.691595 7.71575 11.595695 7.71575 11.467906 V 7.954153 C 7.71575 6.245226 9.025431 4.951423 10.798336 4.951423 C 11.469237 4.951423 12.092006 5.175079 12.619207 5.574358 L 9.472777 7.395196 C 9.281176 7.50694 9.185309 7.666652 9.185309 7.890341 V 12.522141 L 9.185143 12.522008 Z
    M 12.004194 14.151079 L 10.127467 13.096976 V 10.861015 L 12.004194 9.806913 L 13.880788 10.861015 V 13.096976 L 12.004194 14.151079 Z
    M 13.210053 19.006569 C 12.539184 19.006569 11.916416 18.782913 11.389215 18.383667 L 14.535612 16.562796 C 14.727245 16.451051 14.823112 16.29134 14.823112 16.06765 V 11.43585 L 16.148838 12.202452 C 16.260583 12.266264 16.308549 12.36213 16.308549 12.489953 V 16.003706 C 16.308549 17.712632 14.982824 19.006436 13.210053 19.006436 V 19.006569 Z
    M 9.42471 15.444882 L 6.374014 13.688022 C 5.495501 13.176832 4.904621 12.09084 4.904621 11.036738 C 4.904621 9.806913 5.639334 8.704877 6.773259 8.241653 V 11.883196 C 6.773259 12.106852 6.86916 12.266563 7.06076 12.378341 L 11.053781 14.694158 L 9.7441 15.444882 C 9.632355 15.508693 9.536455 15.508693 9.42471 15.444882 Z
    M 9.249121 18.064244 C 7.444294 18.064244 6.118602 16.70663 6.118602 15.029592 C 6.118602 14.901803 6.134613 14.774014 6.150491 14.646225 L 9.296921 16.467062 C 9.488521 16.57884 9.680288 16.57884 9.871889 16.467062 L 13.880788 14.151245 V 15.668571 C 13.880788 15.796361 13.832854 15.892227 13.721076 15.956039 L 10.670413 17.712932 C 10.255123 17.952499 9.759978 18.064244 9.248954 18.064244 H 9.249121 Z
    M 13.210053 19.964804 C 15.142669 19.964804 16.755728 18.591279 17.123218 16.770441 C 18.912033 16.307218 20.062003 14.63018 20.062003 12.921254 C 20.062003 11.803173 19.582902 10.717182 18.720399 9.934535 C 18.800255 9.599101 18.848189 9.263667 18.848189 8.928399 C 18.848189 6.644472 16.995429 4.935379 14.855168 4.935379 C 14.424033 4.935379 14.008743 4.99919 13.593454 5.143024 C 12.874619 4.440233 11.884361 3.993054 10.798336 3.993054 C 8.865753 3.993054 7.252693 5.366546 6.885204 7.187384 C 5.096388 7.650607 3.946419 9.327645 3.946419 11.036571 C 3.946419 12.154652 4.42552 13.240644 5.288022 14.02329 C 5.208166 14.358724 5.160233 14.694158 5.160233 15.029459 C 5.160233 17.313387 7.012993 19.022447 9.153221 19.022447 C 9.584388 19.022447 9.999678 18.958635 10.414968 18.814802 C 11.133637 19.517592 12.123895 19.964804 13.210053 19.964804 Z
  `.trim(),
};

const serviceIcons: Record<string, ServiceIcon> = {
  cloudflare: siCloudflare,
  notion: siNotion,
  github: siGithub,
  claude: siClaude,
  chatgpt: chatgptIcon,
};

const statusColors: Record<NormalizedStatus, string> = {
  operational: "bg-healthy-bg text-healthy",
  degraded_performance: "bg-degraded-bg text-degraded",
  partial_outage: "bg-partial-bg text-partial",
  major_outage: "bg-outage-bg text-outage",
  under_maintenance: "bg-maintenance-bg text-maintenance",
  unknown: "bg-unknown-bg text-unknown",
};

const statusBorders: Record<NormalizedStatus, string> = {
  operational: "border-t-line-strong",
  degraded_performance: "border-t-degraded",
  partial_outage: "border-t-partial",
  major_outage: "border-t-outage",
  under_maintenance: "border-t-maintenance",
  unknown: "border-t-unknown",
};

const incidentStateColors: Record<DashboardIncident["state"], string> = {
  investigating: "bg-partial-bg text-partial",
  identified: "bg-partial-bg text-partial",
  scheduled: "bg-partial-bg text-partial",
  monitoring: "bg-degraded-bg text-degraded",
  resolved: "bg-healthy-bg text-healthy",
  unknown: "bg-unknown-bg text-unknown",
};

const incidentImpactColors: Record<NormalizedStatus, string> = {
  operational: "bg-unknown-bg text-unknown",
  degraded_performance: "bg-degraded-bg text-degraded",
  partial_outage: "bg-partial-bg text-partial",
  major_outage: "bg-outage-bg text-outage",
  under_maintenance: "bg-maintenance-bg text-maintenance",
  unknown: "bg-unknown-bg text-unknown",
};

export function ServiceCard({ service }: { service: DashboardService }) {
  const [showHealthyComponents, setShowHealthyComponents] = useState(false);
  const icon = serviceIcons[service.id];
  const iconColor = icon?.hex ? `#${icon.hex}` : undefined;
  const invertMonochromeIconInDark = service.id === "github" || service.id === "notion";
  const { assigned, unassigned } = assignIncidents(service);
  const components = service.components.toSorted((left, right) => {
    const abnormalDifference = Number(isAbnormal(right.status)) - Number(isAbnormal(left.status));
    const statusDifference = STATUS_RANK[right.status] - STATUS_RANK[left.status];
    return (
      abnormalDifference ||
      statusDifference ||
      left.name.localeCompare(right.name, "ja") ||
      left.id.localeCompare(right.id)
    );
  });
  // Keep a healthy component visible when it owns an active incident, so each
  // incident summary remains visible in the initial service list.
  const visibleComponents = components.filter(
    (component) => isAbnormal(component.status) || (assigned.get(component.id)?.length ?? 0) > 0,
  );
  const healthyComponents = components.filter(
    (component) => !isAbnormal(component.status) && (assigned.get(component.id)?.length ?? 0) === 0,
  );
  const healthyComponentsId = `healthy-components-${service.id}`;

  return (
    <li
      className={`min-w-0 rounded-lg border border-line border-t-4 bg-surface px-5 pt-4 pb-2.5 shadow-sm max-sm:px-3 max-sm:pt-3 max-sm:pb-2 ${statusBorders[service.status]}`}
      id={`service-details-${service.id}`}
      aria-label={`${service.name}のサービス状況`}
    >
      <header className="flex items-center gap-2 border-b border-line pb-3 max-sm:items-start">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center text-muted dark:text-ink max-sm:h-6 max-sm:w-6 [&>svg]:h-5 [&>svg]:w-5 [&>svg]:fill-current ${invertMonochromeIconInDark ? "dark:[&>svg]:invert" : ""}`}
          style={{ color: iconColor }}
          aria-hidden="true"
        >
          {icon ? (
            <svg viewBox="0 0 24 24">
              <path d={icon.path} />
            </svg>
          ) : (
            service.name.slice(0, 1)
          )}
        </span>
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

      {components.length > 0 && (
        <section className="mt-2.5" aria-label={`${service.name}のコンポーネント`}>
          <h3 className="mt-0 mb-1 text-xs font-semibold text-muted">コンポーネント</h3>
          <div>
            {visibleComponents.length > 0 && (
              <ul
                className="m-0 list-none border-t border-line p-0"
                aria-label="表示中のコンポーネント"
              >
                {visibleComponents.map((component) => (
                  <ComponentItem
                    key={component.id}
                    component={component}
                    incidents={assigned.get(component.id) ?? []}
                  />
                ))}
              </ul>
            )}
            {healthyComponents.length > 0 && (
              <>
                <button
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-0 border-b border-line bg-transparent px-0.5 py-2 text-left text-xs font-semibold text-healthy underline-offset-2 hover:underline"
                  type="button"
                  aria-expanded={showHealthyComponents}
                  aria-controls={healthyComponentsId}
                  onClick={() => setShowHealthyComponents((visible) => !visible)}
                >
                  <span
                    className={`w-3 shrink-0 text-center text-lg leading-none text-quiet transition-transform duration-150 ${showHealthyComponents ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                  {showHealthyComponents
                    ? "正常なコンポーネントを非表示"
                    : `正常なコンポーネント ${healthyComponents.length}件を表示`}
                </button>
                <ul
                  className="m-0 list-none p-0"
                  id={healthyComponentsId}
                  aria-label="正常なコンポーネント"
                  hidden={!showHealthyComponents}
                >
                  {healthyComponents.map((component) => (
                    <ComponentItem
                      key={component.id}
                      component={component}
                      incidents={assigned.get(component.id) ?? []}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}

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

function ComponentItem({
  component,
  incidents,
}: {
  component: DashboardComponent;
  incidents: DashboardIncident[];
}) {
  return (
    <li className="border-b border-line" aria-label={`${component.name}コンポーネント`}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-2 px-0.5 py-2 text-xs text-ink max-sm:gap-1.5">
        <h4 className="m-0 min-w-0 [overflow-wrap:anywhere] font-semibold">{component.name}</h4>
        <span
          className={`inline-flex min-h-6 items-center gap-2 whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold ${statusColors[component.status]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {STATUS_LABELS[component.status]}
        </span>
      </div>
      {incidents.length > 0 && <IncidentList incidents={incidents} nested />}
    </li>
  );
}

function IncidentList({
  incidents,
  nested: nestedProp,
}: {
  incidents: DashboardIncident[];
  nested?: boolean;
}) {
  const nested = nestedProp ?? false;

  return (
    <ul className={`m-0 block list-none border-t border-line p-0 ${nested ? "mb-2 ml-5" : ""}`}>
      {incidents.map((incident) => (
        <li className="border-b border-line" key={incident.id} aria-label={incident.title}>
          <details className="group">
            <summary className="relative grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3.5 gap-y-2 py-2 pr-1 pl-5 text-ink max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:gap-x-2.5 max-sm:gap-y-1.5">
              <span
                className="absolute left-0.5 text-lg leading-none text-quiet transition-transform duration-150 group-open:rotate-90"
                aria-hidden="true"
              >
                ›
              </span>
              <span className="min-w-0 text-xs font-semibold leading-normal [overflow-wrap:anywhere] max-sm:col-span-full">
                {incident.title}
              </span>
              <span
                className={`inline-flex min-h-5 items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold ${incidentStateColors[incident.state]}`}
              >
                {incidentStateLabel(incident.state)}
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
                  className={`inline-flex min-h-5 items-center rounded-sm px-1.5 py-0.5 text-xs font-bold ${incident.kind === "maintenance" ? "bg-maintenance-bg text-maintenance" : "bg-outage-bg text-outage"}`}
                >
                  {incident.kind === "maintenance" ? "メンテナンス" : "障害情報"}
                </span>
                {incident.severityStatus && (
                  <span
                    className={`inline-flex min-h-5 items-center rounded-sm px-1.5 py-0.5 text-xs font-bold ${incidentImpactColors[incident.severityStatus]}`}
                  >
                    {`${incident.kind === "maintenance" ? "メンテナンス状態" : "障害の重要度"}: ${STATUS_LABELS[incident.severityStatus]}`}
                  </span>
                )}
              </div>
              {incident.sourceStatus === INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS ? (
                <p className="mt-1.5 mb-0 max-w-3xl text-xs leading-relaxed text-muted">
                  復旧状況を確認できていません。
                </p>
              ) : (
                incident.body && (
                  <p className="mt-1.5 mb-0 max-h-48 max-w-3xl overflow-auto overscroll-contain whitespace-pre-wrap text-xs leading-relaxed text-incident-body [overflow-wrap:anywhere] max-sm:max-h-28">
                    {incident.body}
                  </p>
                )
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

function assignIncidents(service: DashboardService): {
  assigned: Map<string, DashboardIncident[]>;
  unassigned: DashboardIncident[];
} {
  const assigned = new Map<string, DashboardIncident[]>();
  const knownComponents = new Map(service.components.map((component) => [component.id, component]));
  const unassigned: DashboardIncident[] = [];
  const seenIncidentIds = new Set<string>();

  for (const incident of service.incidents) {
    if (seenIncidentIds.has(incident.id)) continue;
    seenIncidentIds.add(incident.id);

    const matchedIds = incident.componentIds.filter((id) => knownComponents.has(id));
    const matchedComponents =
      matchedIds.length > 0
        ? matchedIds.map((id) => knownComponents.get(id)!)
        : service.components.filter((component) => incident.components.includes(component.name));
    if (matchedComponents.length === 0) {
      unassigned.push(incident);
      continue;
    }
    const component =
      matchedComponents.find((candidate) => isAbnormal(candidate.status)) ?? matchedComponents[0]!;
    const list = assigned.get(component.id) ?? [];
    list.push(incident);
    assigned.set(component.id, list);
  }

  return { assigned, unassigned };
}
