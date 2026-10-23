import { useState } from "react";
import { siGithub, siNotion, type SimpleIcon } from "simple-icons";
import type { DashboardIncident, DashboardComponent, DashboardService } from "../domain";
import { ExternalIcon, WarningIcon } from "./icons";
import {
  formatDateTime,
  incidentStateLabel,
  isAbnormal,
  relativeTime,
  STATUS_LABELS,
  STATUS_RANK,
} from "./status-presentation";

const serviceIcons: Record<string, SimpleIcon> = {
  notion: siNotion,
  github: siGithub,
};

export function ServiceCard({ service }: { service: DashboardService }) {
  const [showHealthyComponents, setShowHealthyComponents] = useState(false);
  const icon = serviceIcons[service.id];
  const iconColor = icon ? `#${icon.hex}` : "currentColor";
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
      className={`service-card status-${service.status}`}
      id={`service-details-${service.id}`}
      aria-label={`${service.name}のサービス状況`}
    >
      <header className="service-card-header">
        <span
          className={`service-icon service-icon-${service.id}`}
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
        <div className="service-card-title">
          <h2>
            <a
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
            className={`status-pill status-pill-${service.status}`}
            aria-label={`公式全体ステータス: ${STATUS_LABELS[service.status]}`}
          >
            <span className="status-pip" aria-hidden="true" />
            {STATUS_LABELS[service.status]}
          </span>
        </div>
      </header>

      {service.status !== "operational" && service.summary && (
        <p className="service-summary">{service.summary}</p>
      )}

      {service.hasFetchError && (
        <output className="service-warning">
          <WarningIcon />
          このサービスの最新情報を取得できません。状態は前回取得時のものです。
        </output>
      )}
      {service.isStale && !service.hasFetchError && (
        <output className="service-warning stale-warning">
          <WarningIcon />
          {service.lastSuccessAt
            ? `前回の情報更新から${relativeTime(service.lastSuccessAt)}経過しています。最新の状態と異なる可能性があります。`
            : "最新情報をまだ取得できていません。公式ステータスページで状態をご確認ください。"}
        </output>
      )}

      {components.length > 0 && (
        <section className="component-section" aria-label={`${service.name}のコンポーネント`}>
          <h3>コンポーネント</h3>
          <div className="component-listing">
            {visibleComponents.length > 0 && (
              <ul className="component-item-list" aria-label="表示中のコンポーネント">
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
                  className="component-toggle"
                  type="button"
                  aria-expanded={showHealthyComponents}
                  aria-controls={healthyComponentsId}
                  onClick={() => setShowHealthyComponents((visible) => !visible)}
                >
                  {showHealthyComponents
                    ? "正常なコンポーネントを非表示"
                    : `正常なコンポーネント ${healthyComponents.length}件を表示`}
                </button>
                <ul
                  className="component-item-list"
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
        <section
          className="service-direct-incidents"
          aria-label={`${service.name}の障害・メンテナンス情報`}
        >
          <h3>その他の障害・メンテナンス情報</h3>
          <IncidentList incidents={unassigned} />
        </section>
      )}

      <footer className="service-meta">
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
    <li
      className={`component-item status-${component.status}`}
      aria-label={`${component.name}コンポーネント`}
    >
      <div className="component-row-heading">
        <h4 className="component-summary-name">{component.name}</h4>
        <span className={`status-pill status-pill-${component.status}`}>
          <span className="status-pip" aria-hidden="true" />
          {STATUS_LABELS[component.status]}
        </span>
      </div>
      {incidents.length > 0 && <IncidentList incidents={incidents} />}
    </li>
  );
}

function IncidentList({ incidents }: { incidents: DashboardIncident[] }) {
  return (
    <ul className="incident-list">
      {incidents.map((incident) => (
        <li className="incident-item" key={incident.id} aria-label={incident.title}>
          <details>
            <summary className="incident-summary">
              <span className="incident-title">{incident.title}</span>
              <span className={`incident-state incident-state-${incident.state}`}>
                {incidentStateLabel(incident.state)}
              </span>
              <span className="incident-updated">
                更新{" "}
                {incident.officialUpdatedAt ? (
                  <time dateTime={incident.officialUpdatedAt}>
                    {formatDateTime(incident.officialUpdatedAt)}
                  </time>
                ) : (
                  "時刻不明"
                )}
              </span>
              <span className="incident-disclosure-label">詳細</span>
            </summary>
            <div className="incident-detail">
              <div className="incident-detail-meta">
                <span className={`incident-kind incident-kind-${incident.kind}`}>
                  {incident.kind === "maintenance" ? "メンテナンス" : "障害情報"}
                </span>
                {incident.severityStatus && (
                  <span className={`incident-impact impact-${incident.severityStatus}`}>
                    {`${incident.kind === "maintenance" ? "メンテナンス状態" : "障害の重要度"}: ${STATUS_LABELS[incident.severityStatus]}`}
                  </span>
                )}
              </div>
              {incident.body && <p className="incident-body">{incident.body}</p>}
              {incident.components.length > 0 && (
                <p className="component-list" aria-label="公式の影響対象">
                  影響対象: {incident.components.join("、")}
                </p>
              )}
              <div className="incident-times">
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
                  className="incident-official-link"
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
