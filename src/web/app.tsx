import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_POLL_INTERVAL_MS, SERVICES } from "../shared/config/services";
import type { DashboardPayload } from "../domain";
import { fetchDashboard } from "./api";
import { EventRow } from "./event-row";
import { RefreshIcon, SearchIcon } from "./icons";
import { ServiceCard } from "./service-card";
import { getSelectedServiceIds, getServiceSelectionUrl } from "./service-filter";
import { servicePriority } from "./status-presentation";

type DashboardLoader = () => Promise<DashboardPayload>;

export function App({ load = fetchDashboard }: { load?: DashboardLoader }) {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [query, setQuery] = useState("");
  const [locationSearch, setLocationSearch] = useState(() => window.location.search);
  const [draftServiceIds, setDraftServiceIds] = useState(() =>
    getSelectedServiceIds(window.location.search),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const inFlight = useRef(false);

  useEffect(() => {
    const syncSelectionFromUrl = () => {
      setLocationSearch(window.location.search);
      setDraftServiceIds(getSelectedServiceIds(window.location.search));
      setCopyStatus("idle");
    };

    window.addEventListener("popstate", syncSelectionFromUrl);
    return () => window.removeEventListener("popstate", syncSelectionFromUrl);
  }, []);

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

  const activeServiceIds = useMemo(
    () => new Set(getSelectedServiceIds(locationSearch)),
    [locationSearch],
  );

  const filteredServices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ja");
    return orderedServices.filter(
      (service) =>
        activeServiceIds.has(service.id) &&
        (!needle || service.name.toLocaleLowerCase("ja").includes(needle)),
    );
  }, [activeServiceIds, orderedServices, query]);

  const serviceIds = new Set(filteredServices.map((service) => service.id));
  const filteredRecentEvents = (payload?.recentEvents ?? []).filter((event) =>
    serviceIds.has(event.serviceId),
  );
  const shareUrl = new URL(window.location.href);
  shareUrl.search = locationSearch;
  const allDraftServicesSelected = draftServiceIds.length === SERVICES.length;
  const someDraftServicesSelected = draftServiceIds.length > 0 && !allDraftServicesSelected;

  const toggleDraftService = (serviceId: string, checked: boolean) => {
    setDraftServiceIds((current) => {
      const selected = new Set(current);
      if (checked) selected.add(serviceId);
      else selected.delete(serviceId);
      return SERVICES.filter((service) => selected.has(service.id)).map((service) => service.id);
    });
    setCopyStatus("idle");
  };

  const applyServiceSelection = () => {
    if (draftServiceIds.length === 0) return;
    const nextUrl = getServiceSelectionUrl(window.location.href, draftServiceIds);
    window.history.pushState(null, "", nextUrl);
    setLocationSearch(window.location.search);
    setDraftServiceIds(getSelectedServiceIds(window.location.search));
    setCopyStatus("idle");
  };

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

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
        <details className="group mb-6 rounded-lg border border-line-strong bg-surface dark:border-line">
          <summary
            className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-healthy"
            aria-label="表示サービスを選択"
          >
            <span>表示サービスを選択</span>
            <span className="flex items-center gap-2 whitespace-nowrap text-xs font-normal text-muted">
              {draftServiceIds.length}/{SERVICES.length}件
              <span
                className="text-base leading-none transition-transform group-open:rotate-180"
                aria-hidden="true"
              >
                ⌄
              </span>
            </span>
          </summary>
          <div className="border-t border-line px-4 py-4 dark:border-line">
            <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
              <legend className="sr-only">表示するサービス</legend>
              <label className="flex min-h-8 items-center gap-2 text-sm font-medium text-ink sm:col-span-2">
                <input
                  className="h-4 w-4 accent-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-healthy"
                  type="checkbox"
                  checked={allDraftServicesSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = someDraftServicesSelected;
                  }}
                  onChange={(event) => {
                    setDraftServiceIds(
                      event.target.checked ? SERVICES.map((service) => service.id) : [],
                    );
                    setCopyStatus("idle");
                  }}
                />
                すべて選択
              </label>
              {SERVICES.map((service) => (
                <label
                  className="flex min-h-8 items-center gap-2 text-sm text-ink"
                  key={service.id}
                >
                  <input
                    className="h-4 w-4 accent-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-healthy"
                    type="checkbox"
                    checked={draftServiceIds.includes(service.id)}
                    onChange={(event) => toggleDraftService(service.id, event.target.checked)}
                  />
                  {service.name}
                </label>
              ))}
            </fieldset>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-forest bg-forest px-3 text-xs font-semibold text-white transition-colors enabled:hover:bg-forest/90 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={applyServiceSelection}
                disabled={draftServiceIds.length === 0}
              >
                この条件で表示
              </button>
              {draftServiceIds.length === 0 && (
                <span className="text-xs text-muted">1件以上選択してください。</span>
              )}
            </div>
            <div className="mt-4 border-t border-line pt-4 dark:border-line">
              <label className="mb-2 block text-xs font-semibold text-ink" htmlFor="share-url">
                現在の表示条件を共有
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="min-h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-xs text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-healthy"
                  id="share-url"
                  readOnly
                  value={shareUrl.toString()}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  className="inline-flex min-h-9 items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-control-hover"
                  type="button"
                  onClick={() => void copyShareUrl()}
                >
                  URLをコピー
                </button>
              </div>
              {copyStatus === "copied" && (
                <output className="mt-2 block text-xs text-healthy">URLをコピーしました。</output>
              )}
              {copyStatus === "error" && (
                <output className="mt-2 block text-xs text-alert">
                  URLをコピーできませんでした。入力欄からコピーしてください。
                </output>
              )}
            </div>
          </div>
        </details>
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
            {activeServiceIds.size === 0
              ? "表示するサービスがありません。「表示サービスを選択」から選んでください。"
              : `「${query}」に一致するサービスはありません。`}
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
            {activeServiceIds.size === 0
              ? "選択されたサービスの最近の更新はありません。"
              : query.trim()
                ? "検索条件に一致する最近の更新はありません。"
                : "最近の障害・メンテナンスの更新はありません。"}
          </div>
        )}
      </section>
    </main>
  );
}
