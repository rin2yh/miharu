import { useState } from "react";
import { SERVICES } from "../../shared/config/services";

type ServiceSelectorProps = {
  selectedServiceIds: string[];
  onApply: (serviceIds: string[]) => void;
};

export function ServiceSelector({ selectedServiceIds, onApply }: ServiceSelectorProps) {
  const [draftServiceIds, setDraftServiceIds] = useState(selectedServiceIds);

  const allDraftServicesSelected = draftServiceIds.length === SERVICES.length;
  const someDraftServicesSelected = draftServiceIds.length > 0 && !allDraftServicesSelected;
  const appliedServiceIds = new Set(selectedServiceIds);
  const hasUnappliedServiceSelection =
    draftServiceIds.length !== appliedServiceIds.size ||
    draftServiceIds.some((serviceId) => !appliedServiceIds.has(serviceId));

  const updateDraftSelection = (serviceIds: string[]) => {
    setDraftServiceIds(serviceIds);
  };

  const toggleDraftService = (serviceId: string, checked: boolean) => {
    const selected = new Set(draftServiceIds);
    if (checked) selected.add(serviceId);
    else selected.delete(serviceId);
    updateDraftSelection(
      SERVICES.filter((service) => selected.has(service.id)).map((service) => service.id),
    );
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
      <div className="border-t border-line px-4 py-3 dark:border-line">
        <fieldset className="m-0 grid max-w-2xl grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-x-6 gap-y-1 border-0 p-0">
          <legend className="sr-only">表示するサービス</legend>
          <label className="col-span-full flex min-h-7 items-center gap-2 text-sm font-medium text-ink">
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
              }}
            />
            すべて選択
          </label>
          {SERVICES.map((service) => (
            <label className="flex min-h-7 items-center gap-2 text-sm text-ink" key={service.id}>
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
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-forest bg-forest px-3 text-xs font-semibold text-white transition-colors enabled:hover:bg-forest/90 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => {
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
      </div>
    </details>
  );
}
