import { useState } from "react";
import { SERVICES } from "../shared/config/services";

type ServiceSelectorProps = {
  locationSearch: string;
  selectedServiceIds: string[];
  shareUrl: string;
  onApply: (serviceIds: string[]) => void;
};

type DraftSelection = {
  locationSearch: string;
  serviceIds: string[];
};

export function ServiceSelector({
  locationSearch,
  selectedServiceIds,
  shareUrl,
  onApply,
}: ServiceSelectorProps) {
  const [draftSelection, setDraftSelection] = useState<DraftSelection>(() => ({
    locationSearch,
    serviceIds: selectedServiceIds,
  }));
  if (draftSelection.locationSearch !== locationSearch) {
    setDraftSelection({ locationSearch, serviceIds: selectedServiceIds });
  }
  const [copyResult, setCopyResult] = useState<{
    shareUrl: string;
    status: "copied" | "error";
  } | null>(null);
  const draftServiceIds = draftSelection.serviceIds;
  const copyStatus = copyResult?.shareUrl === shareUrl ? copyResult.status : "idle";

  const allDraftServicesSelected = draftServiceIds.length === SERVICES.length;
  const someDraftServicesSelected = draftServiceIds.length > 0 && !allDraftServicesSelected;
  const appliedServiceIds = new Set(selectedServiceIds);
  const hasUnappliedServiceSelection =
    draftServiceIds.length !== appliedServiceIds.size ||
    draftServiceIds.some((serviceId) => !appliedServiceIds.has(serviceId));

  const updateDraftSelection = (serviceIds: string[]) => {
    setDraftSelection({ locationSearch, serviceIds });
  };

  const toggleDraftService = (serviceId: string, checked: boolean) => {
    const selected = new Set(draftServiceIds);
    if (checked) selected.add(serviceId);
    else selected.delete(serviceId);
    updateDraftSelection(
      SERVICES.filter((service) => selected.has(service.id)).map((service) => service.id),
    );
    setCopyResult(null);
  };

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyResult({ shareUrl, status: "copied" });
    } catch {
      setCopyResult({ shareUrl, status: "error" });
    }
  };

  return (
    <details className="group mb-6 rounded-lg border border-line-strong bg-surface dark:border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-healthy">
        <span>表示サービスを選択</span>
        <span className="flex items-center gap-2 whitespace-nowrap text-xs font-normal text-muted">
          {draftServiceIds.length}/{SERVICES.length}件
          {hasUnappliedServiceSelection && (
            <span className="text-[11px] font-semibold">未適用</span>
          )}
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
                updateDraftSelection(
                  event.target.checked ? SERVICES.map((service) => service.id) : [],
                );
                setCopyResult(null);
              }}
            />
            すべて選択
          </label>
          {SERVICES.map((service) => (
            <label className="flex min-h-8 items-center gap-2 text-sm text-ink" key={service.id}>
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
            onClick={() => {
              setCopyResult(null);
              onApply(draftServiceIds);
            }}
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
              value={shareUrl}
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
  );
}
