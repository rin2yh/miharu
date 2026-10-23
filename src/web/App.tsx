import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type { DashboardPayload } from "../domain";
import { fetchDashboard } from "./api";
import { EventRow } from "./EventRow";
import { RefreshIcon, SearchIcon } from "./icons";
import { ServiceCard } from "./ServiceCard";
import { servicePriority } from "./status-presentation";

type DashboardLoader = () => Promise<DashboardPayload>;

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
          <ul className="service-list" aria-label="サービス一覧">
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
