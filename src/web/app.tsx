import { useEffect, useRef, useState } from "react";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type { DashboardPayload } from "../domain";
import { fetchDashboard } from "./api";
import { AppSidebar } from "./components/app-sidebar";
import { AppBrand } from "./components/app-brand";
import { EventRow } from "./components/event-row";
import { RefreshIcon } from "./components/icons";
import { ServiceCard } from "./components/service-card";
import { ServiceSearch } from "./components/service-search";
import { ServiceSelector } from "./components/service-selector";
import { getSelectedServiceIds, getServiceSelectionUrl } from "./filters/service-filter";
import { servicePriority } from "./presentation/status-presentation";

type DashboardLoader = () => Promise<DashboardPayload>;

export function App({ load: providedLoad }: { load?: DashboardLoader }) {
  const load = providedLoad ?? fetchDashboard;
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [query, setQuery] = useState("");
  const [locationSearch, setLocationSearch] = useState(() => window.location.search);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const syncSelectionFromUrl = () => {
      setLocationSearch(window.location.search);
    };

    window.addEventListener("popstate", syncSelectionFromUrl);
    return () => window.removeEventListener("popstate", syncSelectionFromUrl);
  }, []);

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await load();
      setPayload(result);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    inFlight.current = false;
  };

  const refreshManually = async () => {
    if (inFlight.current) return;
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
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

  const orderedServices = [...(payload?.services ?? [])];
  orderedServices.sort((left, right) => {
    const incidentDifference =
      Number(right.incidents.length > 0) - Number(left.incidents.length > 0);
    const priorityDifference = servicePriority(right) - servicePriority(left);
    return incidentDifference || priorityDifference || left.name.localeCompare(right.name, "ja");
  });

  const selectedServiceIds = getSelectedServiceIds(locationSearch);
  const activeServiceIds = new Set(selectedServiceIds);
  const needle = query.trim().toLocaleLowerCase("ja");
  const filteredServices = orderedServices.filter(
    (service) =>
      activeServiceIds.has(service.id) &&
      (!needle || service.name.toLocaleLowerCase("ja").includes(needle)),
  );

  const visibleServiceIds = new Set(filteredServices.map((service) => service.id));
  const filteredRecentEvents = (payload?.recentEvents ?? []).filter((event) =>
    visibleServiceIds.has(event.serviceId),
  );
  const applyServiceSelection = (selectedIds: string[]) => {
    const nextUrl = getServiceSelectionUrl(window.location.href, selectedIds);
    window.history.pushState(null, "", nextUrl);
    setLocationSearch(window.location.search);
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-6 pt-8 pb-6 max-md:px-4 max-md:pt-5 max-sm:px-3">
      <header className="mb-7 flex min-h-10 items-center justify-between max-md:mb-5 lg:hidden">
        <AppBrand />
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

      <AppSidebar
        selectedServiceIds={selectedServiceIds}
        onSelect={applyServiceSelection}
        query={query}
        onQueryChange={setQuery}
      >
        <div className="min-w-0">
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
              <div className="w-56 max-md:w-auto max-md:flex-1 lg:hidden">
                <ServiceSearch query={query} onChange={setQuery} />
              </div>
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
            <ServiceSelector
              key={locationSearch}
              selectedServiceIds={selectedServiceIds}
              onApply={applyServiceSelection}
            />
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
                条件に一致するサービスはありません。
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
            {filteredRecentEvents.length ? (
              <ol className="m-0 grid list-none gap-0 border-t border-line p-0">
                {filteredRecentEvents.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ol>
            ) : (
              <div className="rounded-lg border border-dashed border-line-strong bg-empty-bg px-5 py-7 text-center text-sm text-muted dark:border-line">
                表示中のサービスに最近の更新はありません。
              </div>
            )}
          </section>
        </div>
      </AppSidebar>
    </main>
  );
}
