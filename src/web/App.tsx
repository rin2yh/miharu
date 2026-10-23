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
    <main className="mx-auto w-[calc(100%-48px)] max-w-[1056px] pt-[30px] pb-6 max-[760px]:w-[calc(100%-32px)] max-[760px]:max-w-[620px] max-[760px]:pt-[19px] max-[480px]:w-[calc(100%-24px)] max-[480px]:max-w-[420px]">
      <header className="mb-7 flex min-h-[38px] items-center justify-between max-[760px]:mb-[19px]">
        <a
          className="inline-flex items-center gap-2.5 text-[15px] font-bold tracking-[-0.02em] text-ink no-underline"
          href="#top"
          aria-label="miharu ホーム"
        >
          <span
            className="flex h-5 w-5 items-end gap-[2px] rounded-[5px] bg-forest px-[3px] py-1"
            aria-hidden="true"
          >
            <span className="block h-[6px] flex-1 rounded-[2px_2px_1px_1px] bg-[#d4e7db]" />
            <span className="block h-[10px] flex-1 rounded-[2px_2px_1px_1px] bg-[#d4e7db]" />
            <span className="block h-2 flex-1 rounded-[2px_2px_1px_1px] bg-[#d4e7db]" />
          </span>
          <span>miharu</span>
        </a>
      </header>

      {loadError && (
        <div
          className="mt-[14px] flex items-center gap-2.5 rounded-[7px] border border-alert-line bg-alert-bg px-[15px] py-3 text-[13px] leading-[1.5] text-alert"
          role="alert"
        >
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-alert-dot" aria-hidden="true" />
          最新情報を取得できません。表示中の情報は前回取得時のものです。
        </div>
      )}

      <section id="top" aria-labelledby="services-title" aria-live="polite">
        <div className="mb-[14px] flex items-baseline justify-between gap-4">
          <h1
            className="m-0 text-[23px] font-bold tracking-[-0.04em] text-ink max-[480px]:text-xl"
            id="services-title"
          >
            サービス稼働状況
          </h1>
          <span className="whitespace-nowrap text-sm text-muted">
            {payload ? `${filteredServices.length}サービス` : "読み込み中"}
          </span>
        </div>
        <div className="mb-[13px] flex justify-end gap-2 max-[760px]:justify-start max-[480px]:gap-[7px]">
          <label className="flex h-[38px] w-[220px] items-center rounded-md border border-line-strong bg-surface px-[10px] text-muted focus-within:border-[#4f8669] focus-within:shadow-[0_0_0_2px_#4f866921] max-[760px]:w-auto max-[760px]:flex-1">
            <SearchIcon />
            <input
              className="w-full min-w-0 border-0 bg-transparent px-[7px] text-xs text-ink placeholder:text-placeholder focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
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
                className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-[18px] leading-none text-muted hover:bg-[#eef2ef] dark:hover:bg-control-hover"
                type="button"
                aria-label="検索をクリア"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            )}
          </label>
          <button
            className="inline-flex h-[38px] items-center justify-center gap-[7px] whitespace-nowrap rounded-md border border-line-strong bg-surface px-3 text-xs font-semibold text-ink transition-[background-color,border-color] duration-[120ms] enabled:hover:border-[#aebdb4] enabled:hover:bg-control-hover disabled:cursor-wait disabled:opacity-70 max-[480px]:w-[39px] max-[480px]:px-0"
            type="button"
            onClick={() => void refreshManually()}
            disabled={refreshing}
          >
            <RefreshIcon spinning={refreshing} />
            <span className="max-[480px]:sr-only">{refreshing ? "更新中" : "手動更新"}</span>
          </button>
        </div>
        {!payload && !loadError && (
          <div className="rounded-[7px] border border-dashed border-line-strong bg-empty-bg px-5 py-[27px] text-center text-[13px] text-muted dark:border-line">
            サービス情報を読み込んでいます…
          </div>
        )}
        {!payload && loadError && (
          <div className="rounded-[7px] border border-dashed border-line-strong bg-empty-bg px-5 py-[27px] text-center text-[13px] text-muted dark:border-line">
            <p className="m-0 mb-2">一覧を読み込めませんでした。</p>
            <button
              className="cursor-pointer border-0 bg-transparent p-0 text-xs font-bold text-forest underline decoration-1 underline-offset-[3px]"
              type="button"
              onClick={() => void refresh()}
            >
              もう一度取得する
            </button>
          </div>
        )}
        {payload && filteredServices.length === 0 && (
          <div className="rounded-[7px] border border-dashed border-line-strong bg-empty-bg px-5 py-[27px] text-center text-[13px] text-muted dark:border-line">
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

      <section className="mt-[39px] max-[760px]:mt-[30px]" aria-labelledby="history-title">
        <div className="mb-4 flex items-end justify-between gap-5 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-[13px]">
          <div>
            <h2
              className="m-0 text-lg font-bold tracking-[-0.03em] text-ink max-[480px]:text-[17px]"
              id="history-title"
            >
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
          <div className="rounded-[7px] border border-dashed border-line-strong bg-empty-bg px-5 py-[27px] text-center text-[13px] text-muted dark:border-line">
            最近の障害・メンテナンスの更新はありません。
          </div>
        )}
      </section>
    </main>
  );
}
