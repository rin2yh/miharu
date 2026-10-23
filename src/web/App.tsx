import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { siGithub, siNotion, type SimpleIcon } from "simple-icons";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type {
  DashboardIncident,
  DashboardEvent,
  DashboardPayload,
  DashboardComponent,
  DashboardService,
  NormalizedStatus,
} from "../domain";
import { fetchDashboard } from "./api";

type DashboardLoader = () => Promise<DashboardPayload>;

const serviceIcons: Record<string, SimpleIcon> = {
  notion: siNotion,
  github: siGithub,
};

const STATUS_LABELS: Record<NormalizedStatus, string> = {
  operational: "正常",
  degraded_performance: "性能低下",
  partial_outage: "部分障害",
  major_outage: "全面障害",
  under_maintenance: "メンテナンス",
  unknown: "状態不明",
};

const STATUS_RANK: Record<NormalizedStatus, number> = {
  operational: 0,
  unknown: 1,
  under_maintenance: 2,
  degraded_performance: 3,
  partial_outage: 4,
  major_outage: 5,
};

export function App({ load = fetchDashboard }: { load?: DashboardLoader }) {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await load();
      setPayload(result);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      inFlight.current = false;
    }
  }, [load]);

  const refreshManually = async () => {
    if (inFlight.current) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadLatest = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      load()
        .then((result) => {
          if (!cancelled) {
            setPayload(result);
            setLoadError(false);
          }
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        })
        .finally(() => {
          inFlight.current = false;
        });
    };

    loadLatest();
    const interval = window.setInterval(loadLatest, DASHBOARD_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [load]);

  const orderedServices = useMemo(() => {
    const services = [...(payload?.services ?? [])];
    services.sort((left, right) => {
      const incidentDifference =
        Number(right.incidents.length > 0) - Number(left.incidents.length > 0);
      const priorityDifference = servicePriority(right) - servicePriority(left);
      return incidentDifference || priorityDifference || left.name.localeCompare(right.name, "ja");
    });
    return services;
  }, [payload]);

  const filteredServices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ja");
    if (!needle) return orderedServices;
    return orderedServices.filter((service) =>
      service.name.toLocaleLowerCase("ja").includes(needle),
    );
  }, [orderedServices, query]);

  return (
    <main className="page-shell">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="miharu ホーム">
          <span className="wordmark-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>miharu</span>
        </a>
      </header>

      {loadError && (
        <div className="global-alert" role="alert">
          <span className="alert-dot" aria-hidden="true" />
          最新情報を取得できません。表示中の情報は前回取得時のものです。
        </div>
      )}

      <section
        className="service-overview"
        id="top"
        aria-labelledby="services-title"
        aria-live="polite"
      >
        <div className="service-overview-heading">
          <h1 id="services-title">サービス稼働状況</h1>
          <span className="service-count">
            {payload ? `${filteredServices.length}サービス` : "読み込み中"}
          </span>
        </div>
        <div className="service-overview-controls">
          <label className="search-box">
            <SearchIcon />
            <input
              id="service-search"
              name="service"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="サービスを検索"
              aria-label="サービスを検索"
            />
            {query && (
              <button
                className="clear-search"
                type="button"
                aria-label="検索をクリア"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            )}
          </label>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void refreshManually()}
            disabled={refreshing}
          >
            <RefreshIcon spinning={refreshing} />
            <span>{refreshing ? "更新中" : "手動更新"}</span>
          </button>
        </div>
        {!payload && !loadError && (
          <div className="empty-panel">サービス情報を読み込んでいます…</div>
        )}
        {!payload && loadError && (
          <div className="empty-panel error-empty">
            <p>一覧を読み込めませんでした。</p>
            <button className="text-button" type="button" onClick={() => void refresh()}>
              もう一度取得する
            </button>
          </div>
        )}
        {payload && filteredServices.length === 0 && (
          <div className="empty-panel">「{query}」に一致するサービスはありません。</div>
        )}
        {payload && filteredServices.length > 0 && (
          <ul className="service-list">
            {filteredServices.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </ul>
        )}
      </section>

      <section className="history-section" aria-labelledby="history-title">
        <div className="section-heading history-heading">
          <div>
            <h2 id="history-title">最近の更新</h2>
          </div>
        </div>
        {payload?.recentEvents.length ? (
          <ol className="event-list">
            {payload.recentEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ol>
        ) : (
          <div className="history-empty">最近の障害・メンテナンスの更新はありません。</div>
        )}
      </section>
    </main>
  );
}

function ServiceCard({ service }: { service: DashboardService }) {
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
    <li className={`service-card status-${service.status}`} id={`service-details-${service.id}`}>
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
          <span className={`status-pill status-pill-${service.status}`}>
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
              <ul className="component-item-list">
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
  const heading = (
    <>
      <span className="component-summary-name">{component.name}</span>
      <span className={`status-pill status-pill-${component.status}`}>
        <span className="status-pip" aria-hidden="true" />
        {STATUS_LABELS[component.status]}
      </span>
    </>
  );

  return (
    <li className={`component-item status-${component.status}`}>
      <div className="component-row-heading">{heading}</div>
      {incidents.length > 0 && <IncidentList incidents={incidents} />}
    </li>
  );
}

function IncidentList({ incidents }: { incidents: DashboardIncident[] }) {
  return (
    <ul className="incident-list">
      {incidents.map((incident) => (
        <li className="incident-item" key={incident.id}>
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

function incidentStateLabel(state: DashboardIncident["state"]): string {
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

function isAbnormal(status: NormalizedStatus): boolean {
  return status !== "operational";
}

function EventRow({ event }: { event: DashboardEvent }) {
  const labels = {
    opened: event.kind === "maintenance" ? "メンテナンス予定" : "障害発生",
    updated: event.kind === "maintenance" ? "メンテナンス更新" : "障害更新",
    resolved: event.kind === "maintenance" ? "メンテナンス完了" : "復旧",
  };
  return (
    <li className={`event-row event-${event.eventKind}`}>
      <span className="event-mark" aria-hidden="true" />
      <div className="event-copy">
        <div className="event-meta">
          <span>{event.serviceName}</span>
          <span>{labels[event.eventKind]}</span>
        </div>
        <p>
          {event.url ? (
            <a href={event.url} target="_blank" rel="noreferrer noopener">
              {event.title}
              <ExternalIcon />
            </a>
          ) : (
            event.title
          )}
        </p>
        {event.officialEventAt && <small>公式時刻 {formatDateTime(event.officialEventAt)}</small>}
      </div>
    </li>
  );
}

function servicePriority(service: DashboardService): number {
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "時刻不明";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function relativeTime(value: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (elapsedMinutes < 1) return "1分未満";
  if (elapsedMinutes < 60) return `${elapsedMinutes}分`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}時間`;
  return `${Math.floor(hours / 24)}日`;
}

function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? "refresh-icon spinning" : "refresh-icon"}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M20 7v5h-5M4.5 10a7.5 7.5 0 0 1 13-3L20 12M4 17v-5h5m10.5 2a7.5 7.5 0 0 1-13 3L4 12" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="external-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.5 2.5h4v4M13.25 2.75 7.5 8.5M12 8.5v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="warning-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5 18 17H2l8-14.5ZM10 7v4.5m0 2.5h.01" />
    </svg>
  );
}
