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
    <main className="mx-auto w-full max-w-5xl px-6 pt-8 pb-6 max-md:max-w-2xl max-md:px-4 max-md:pt-5 max-sm:max-w-md max-sm:px-3">
      <header className="mb-7 flex min-h-10 items-center justify-between max-md:mb-5">
        <a
          className="inline-flex items-center gap-2.5 text-base font-bold tracking-tight text-ink no-underline"
          href="#top"
          aria-label="miharu ホーム"
        >
          <span
            className="flex h-5 w-5 items-end gap-0.5 rounded-md bg-forest px-1 py-1"
            aria-hidden="true"
          >
            <span className="block h-1.5 flex-1 rounded-t-sm bg-green-100" />
            <span className="block h-2.5 flex-1 rounded-t-sm bg-green-100" />
            <span className="block h-2 flex-1 rounded-t-sm bg-green-100" />
          </span>
          <span>miharu</span>
        </a>
      </header>

      {loadError && (
        <div
          className="mt-3.5 flex items-center gap-2.5 rounded-lg border border-alert-line bg-alert-bg px-4 py-3 text-sm leading-normal text-alert"
          role="alert"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-alert-dot" aria-hidden="true" />
          最新情報を取得できません。表示中の情報は前回取得時のものです。
        </div>
      )}

      <section id="top" aria-labelledby="services-title" aria-live="polite">
        <div className="mb-3.5 flex items-baseline justify-between gap-4">
          <h1
            className="m-0 text-2xl font-bold tracking-tighter text-ink max-sm:text-xl"
            id="services-title"
          >
            サービス稼働状況
          </h1>
          <span className="whitespace-nowrap text-sm text-muted">
            {payload ? `${filteredServices.length}サービス` : "読み込み中"}
          </span>
        </div>
        <div className="mb-3.5 flex justify-end gap-2 max-md:justify-start max-sm:gap-2">
          <label className="flex h-10 w-56 items-center rounded-md border border-line-strong bg-surface px-2.5 text-muted focus-within:border-healthy focus-within:ring-2 focus-within:ring-healthy/20 max-md:w-auto max-md:flex-1">
            <SearchIcon />
            <input
              className="w-full min-w-0 border-0 bg-transparent px-2 text-xs text-ink placeholder:text-placeholder focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
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
                className="grid h-6 w-6 shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-lg leading-none text-muted hover:bg-control-hover"
                type="button"
                aria-label="検索をクリア"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            )}
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-surface px-3 text-xs font-semibold text-ink transition-colors duration-150 enabled:hover:border-line-strong enabled:hover:bg-control-hover disabled:cursor-wait disabled:opacity-70 max-sm:w-10 max-sm:px-0"
            type="button"
            onClick={() => void refreshManually()}
            disabled={refreshing}
          >
            <RefreshIcon spinning={refreshing} />
            <span className="max-sm:sr-only">{refreshing ? "更新中" : "手動更新"}</span>
          </button>
        </div>
        {!payload && !loadError && (
          <div className="rounded-lg border border-dashed border-line-strong bg-empty-bg px-5 py-7 text-center text-sm text-muted dark:border-line">
            サービス情報を読み込んでいます…
          </div>
        )}
        {!payload && loadError && (
          <div className="rounded-lg border border-dashed border-line-strong bg-empty-bg px-5 py-7 text-center text-sm text-muted dark:border-line">
            <p className="m-0 mb-2">一覧を読み込めませんでした。</p>
            <button
              className="cursor-pointer border-0 bg-transparent p-0 text-xs font-bold text-forest underline decoration-1 underline-offset-2"
              type="button"
              onClick={() => void refresh()}
            >
              もう一度取得する
            </button>
          </div>
        )}
        {payload && filteredServices.length === 0 && (
          <div className="rounded-lg border border-dashed border-line-strong bg-empty-bg px-5 py-7 text-center text-sm text-muted dark:border-line">
            「{query}」に一致するサービスはありません。
          </div>
        )}
        {payload && filteredServices.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="サービス一覧">
            {filteredServices.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 max-md:mt-8" aria-labelledby="history-title">
        <div className="mb-4 flex items-end justify-between gap-5 max-md:flex-col max-md:items-start max-md:gap-3">
          <div>
            <h2 className="m-0 text-lg font-bold tracking-tight text-ink" id="history-title">
              最近の更新
            </h2>
          </div>
        </div>
        {payload?.recentEvents.length ? (
          <ol className="m-0 grid list-none gap-0 border-t border-line p-0">
            {payload.recentEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ol>
        ) : (
          <div className="rounded-lg border border-dashed border-line-strong bg-empty-bg px-5 py-7 text-center text-sm text-muted dark:border-line">
            最近の障害・メンテナンスの更新はありません。
          </div>
        )}
      </section>
    </main>
  );
}
