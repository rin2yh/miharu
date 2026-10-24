import { SERVICES } from "../../shared/config/services";
import { ServiceSearch } from "./service-search";

type ServiceSidebarProps = {
  selectedServiceIds: string[];
  onSelect: (serviceIds: string[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
};

export function ServiceSidebar({
  selectedServiceIds,
  onSelect,
  query,
  onQueryChange,
}: ServiceSidebarProps) {
  const selectedIds = new Set(selectedServiceIds);
  const allServicesSelected = selectedServiceIds.length === SERVICES.length;
  const someServicesSelected = selectedServiceIds.length > 0 && !allServicesSelected;
  const needle = query.trim().toLocaleLowerCase("ja");
  const visibleServices = SERVICES.filter((service) =>
    service.name.toLocaleLowerCase("ja").includes(needle),
  );

  const toggleService = (serviceId: string) => {
    const nextSelection = new Set(selectedIds);
    if (nextSelection.has(serviceId)) nextSelection.delete(serviceId);
    else nextSelection.add(serviceId);

    onSelect(
      SERVICES.filter((service) => nextSelection.has(service.id)).map((service) => service.id),
    );
  };

  const selectionButtonClass =
    "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-healthy";

  return (
    <aside
      aria-label="サービス選択"
      className="hidden lg:sticky lg:top-6 lg:block lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto"
    >
      <div className="border-b border-line pb-3">
        <h2 className="m-0 text-sm font-bold text-ink">表示サービス</h2>
        <p className="m-0 mt-1 text-xs text-muted">
          {selectedServiceIds.length} / {SERVICES.length}サービス
        </p>
      </div>
      <div className="mt-3">
        <ServiceSearch
          ariaLabel="サービス一覧を検索"
          clearLabel="サービス一覧の検索をクリア"
          query={query}
          onChange={onQueryChange}
        />
      </div>
      <nav aria-label="表示サービス" className="pt-3">
        <ul className="m-0 list-none space-y-1 p-0">
          <li>
            <button
              aria-pressed={someServicesSelected ? "mixed" : allServicesSelected}
              className={`${selectionButtonClass} ${allServicesSelected ? "bg-healthy-bg font-semibold text-ink" : someServicesSelected ? "font-semibold text-ink" : "text-muted"}`}
              type="button"
              onClick={() =>
                onSelect(allServicesSelected ? [] : SERVICES.map((service) => service.id))
              }
            >
              <span
                aria-hidden="true"
                className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] leading-none ${allServicesSelected || someServicesSelected ? "border-forest bg-forest text-white" : "border-line-strong bg-surface"}`}
              >
                {allServicesSelected ? "✓" : someServicesSelected ? "−" : ""}
              </span>
              <span className="flex-1">すべて</span>
            </button>
          </li>
          {visibleServices.map((service) => {
            const isSelected = selectedIds.has(service.id);
            const isLastSelected = isSelected && selectedServiceIds.length === 1;
            const serviceClassName = isSelected
              ? allServicesSelected
                ? "font-semibold text-ink"
                : "bg-healthy-bg font-semibold text-ink"
              : "text-muted";

            return (
              <li key={service.id}>
                <button
                  aria-pressed={isSelected}
                  className={`${selectionButtonClass} ${serviceClassName} disabled:cursor-not-allowed disabled:opacity-70`}
                  type="button"
                  disabled={isLastSelected}
                  onClick={() => toggleService(service.id)}
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] leading-none ${isSelected ? "border-forest bg-forest text-white" : "border-line-strong bg-surface"}`}
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                  <span className="flex-1">{service.name}</span>
                </button>
              </li>
            );
          })}
          {visibleServices.length === 0 && (
            <li className="px-2.5 py-2 text-xs text-muted">一致するサービスがありません。</li>
          )}
        </ul>
      </nav>
    </aside>
  );
}
