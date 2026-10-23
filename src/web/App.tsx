import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { siGithub, siNotion, type SimpleIcon } from "simple-icons";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type {
  DashboardEvent,
  DashboardPayload,
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

  const sortedServices = useMemo(() => {
    const services = [...(payload?.services ?? [])];
    services.sort((left, right) => {
      const leftActive = left.incidents.length > 0 ? 1 : 0;
      const rightActive = right.incidents.length > 0 ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      const leftStatus = representativeStatus(left);
      const rightStatus = representativeStatus(right);
      const severityDifference = STATUS_RANK[rightStatus] - STATUS_RANK[leftStatus];
      return severityDifference || left.name.localeCompare(right.name, "ja");
    });
    return services;
  }, [payload]);

  const filteredServices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ja");
    if (!needle) return sortedServices;
    return sortedServices.filter((service) => {
      const searchable = [
        service.name,
        ...service.incidents.flatMap((incident) => [
          incident.title,
          incident.body ?? "",
          ...incident.components,
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase("ja");
      return searchable.includes(needle);
    });
  }, [query, sortedServices]);

  const activeCount =
    payload?.services.reduce((count, service) => count + service.incidents.length, 0) ?? 0;
  const staleCount = payload?.services.filter((service) => service.isStale).length ?? 0;

  return (
    <main className="page-shell">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="SaaS稼働状況 ホーム">
          <span className="wordmark-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>SaaS稼働状況</span>
        </a>
        <p className="header-note">公式情報を1分ごとに確認</p>
      </header>

      <section className="overview" id="top" aria-live="polite">
        <div className="overview-copy">
          <p className="eyebrow">稼働状況</p>
          <h1>{overviewTitle(payload, activeCount, staleCount)}</h1>
          <p className="overview-description">
            {payload
              ? `${payload.services.length}つのサービスを監視中${activeCount ? `。確認が必要な情報は${activeCount}件です。` : "。"}`
              : "公式ステータスページから最新情報を取得しています。"}
          </p>
        </div>
        <div className="overview-count" aria-label={`現在の障害情報 ${activeCount} 件`}>
          <span className="overview-number">{activeCount}</span>
          <span className="overview-count-label">障害・メンテナンス</span>
        </div>
      </section>

      {loadError && (
        <div className="global-alert" role="alert">
          <span className="alert-dot" aria-hidden="true" />
          最新の一覧を取得できませんでした。表示中の情報は保持しています。
        </div>
      )}

      <section className="services-section" aria-labelledby="services-title">
        <div className="section-heading">
          <div>
            <h2 id="services-title">サービス一覧</h2>
            <p>状態の変化が大きいサービスから表示します。</p>
          </div>
          <div className="toolbar">
            <label className="search-box">
              <SearchIcon />
              <input
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
        </div>

        {!payload && !loadError && (
          <div className="empty-panel">公式ステータスを確認しています…</div>
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
          <div className="service-list">
            {filteredServices.map((service) => (
              <ServiceRow key={service.id} service={service} />
            ))}
          </div>
        )}
      </section>

      <section className="history-section" aria-labelledby="history-title">
        <div className="section-heading history-heading">
          <div>
            <h2 id="history-title">最近の更新</h2>
            <p>直近7日間の変更から、最新のものを表示しています。</p>
          </div>
        </div>
        {payload?.recentEvents.length ? (
          <ol className="event-list">
            {payload.recentEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ol>
        ) : (
          <div className="history-empty">最近のインシデント更新はありません。</div>
        )}
      </section>

      <footer className="page-footer">
        <span>画面更新 1分</span>
        <span>情報は各サービスの公式ステータスページをご確認ください。</span>
        {payload && <span>画面確認 {formatDateTime(payload.generatedAt)}</span>}
      </footer>
    </main>
  );
}

function ServiceRow({ service }: { service: DashboardService }) {
  const status = representativeStatus(service);
  const icon = serviceIcons[service.id];
  const iconColor = icon ? `#${icon.hex}` : "currentColor";

  return (
    <article className={`service-row status-${status}`}>
      <div className="service-main">
        <div className="service-identity">
          <span className="service-icon" style={{ color: iconColor }} aria-hidden="true">
            {icon ? (
              <svg viewBox="0 0 24 24">
                <path d={icon.path} />
              </svg>
            ) : (
              service.name.slice(0, 1)
            )}
          </span>
          <div className="service-name-wrap">
            <h3>{service.name}</h3>
            <a
              className="official-link"
              href={service.statusPageUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              公式ステータスページ
              <ExternalIcon />
            </a>
          </div>
        </div>
        <div className="service-status-block">
          <span className={`status-pill status-pill-${status}`}>
            <span className="status-pip" aria-hidden="true" />
            {STATUS_LABELS[status]}
          </span>
          {service.status !== status && (
            <span className="official-status-detail">
              公式全体状態: {STATUS_LABELS[service.status]}
            </span>
          )}
        </div>
        <div className="service-freshness">
          {service.lastSuccessAt ? (
            <>
              <span className="freshness-label">最終取得成功</span>
              <time dateTime={service.lastSuccessAt}>{formatDateTime(service.lastSuccessAt)}</time>
            </>
          ) : (
            <span className="freshness-label">取得成功なし</span>
          )}
        </div>
      </div>

      {service.hasFetchError && (
        <output className="service-warning">
          <WarningIcon />
          公式情報の取得に失敗しました。表示中の状態は最後に取得できた情報です。
        </output>
      )}
      {service.isStale && !service.hasFetchError && (
        <output className="service-warning stale-warning">
          <WarningIcon />
          {service.lastSuccessAt
            ? `最終成功から${relativeTime(service.lastSuccessAt)}経過しています。情報が古い可能性があります。`
            : "まだ取得に成功していません。公式ページでも状態をご確認ください。"}
        </output>
      )}

      {service.incidents.length > 0 ? (
        <ul className="incident-list" aria-label={`${service.name}の障害・メンテナンス`}>
          {service.incidents.map((incident) => (
            <li className="incident-item" key={incident.id}>
              <div className="incident-topline">
                <span className={`incident-kind incident-kind-${incident.kind}`}>
                  {incident.kind === "maintenance"
                    ? "メンテナンス"
                    : incident.state === "monitoring"
                      ? "監視中"
                      : "障害情報"}
                </span>
                {incident.severityStatus && (
                  <span className={`incident-impact impact-${incident.severityStatus}`}>
                    {STATUS_LABELS[incident.severityStatus]}
                  </span>
                )}
                {incident.sourceImpact && incident.severityStatus && (
                  <span className="incident-source-impact">
                    公式重要度: {incident.sourceImpact}
                  </span>
                )}
              </div>
              <h4>
                {incident.url ? (
                  <a href={incident.url} target="_blank" rel="noreferrer noopener">
                    {incident.title}
                    <ExternalIcon />
                  </a>
                ) : (
                  incident.title
                )}
              </h4>
              {incident.body && <p className="incident-body">{incident.body}</p>}
              {incident.components.length > 0 && (
                <div className="component-list" aria-label="影響コンポーネント">
                  {incident.components.map((component) => (
                    <span key={component}>{component}</span>
                  ))}
                </div>
              )}
              <div className="incident-times">
                {incident.officialCreatedAt && (
                  <span>公式発生 {formatDateTime(incident.officialCreatedAt)}</span>
                )}
                {incident.officialUpdatedAt && (
                  <span>公式更新 {formatDateTime(incident.officialUpdatedAt)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="no-incidents">現在、公開中の障害情報はありません。</p>
      )}
    </article>
  );
}

function EventRow({ event }: { event: DashboardEvent }) {
  const labels = {
    opened: event.kind === "maintenance" ? "予定を検知" : "発生を検知",
    updated: "内容を更新",
    resolved: "復旧を検知",
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
        <small>
          アプリ検知 {formatDateTime(event.detectedAt)}
          {event.officialEventAt && ` · 公式時刻 ${formatDateTime(event.officialEventAt)}`}
        </small>
      </div>
    </li>
  );
}

function representativeStatus(service: DashboardService): NormalizedStatus {
  return service.incidents.reduce((result, incident) => {
    if (!incident.severityStatus) return result;
    return STATUS_RANK[incident.severityStatus] > STATUS_RANK[result]
      ? incident.severityStatus
      : result;
  }, service.status);
}

function overviewTitle(
  payload: DashboardPayload | null,
  activeCount: number,
  staleCount: number,
): string {
  if (!payload) return "サービスの状態を確認しています";
  if (activeCount > 0) return "障害・メンテナンス情報があります";
  if (staleCount > 0) return "一部の情報を更新できていません";
  if (payload.services.every((service) => service.status === "operational"))
    return "すべて正常に稼働中です";
  if (payload.services.some((service) => service.status === "unknown"))
    return "一部の状態を確認できません";
  return "稼働状況を確認してください";
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
