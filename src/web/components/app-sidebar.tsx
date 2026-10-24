import type { ReactNode } from "react";
import type { DashboardPayload } from "../../domain";
import { ServiceSidebar } from "./service-sidebar";

type AppSidebarProps = {
  orderedServices: DashboardPayload["services"];
  selectedServiceIds: string[];
  onSelect: (serviceIds: string[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  children: ReactNode;
};

export function AppSidebar({
  orderedServices,
  selectedServiceIds,
  onSelect,
  query,
  onQueryChange,
  children,
}: AppSidebarProps) {
  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_1px_minmax(0,1fr)] lg:gap-x-7">
      <ServiceSidebar
        orderedServices={orderedServices}
        selectedServiceIds={selectedServiceIds}
        onSelect={onSelect}
        query={query}
        onQueryChange={onQueryChange}
      />
      <hr
        aria-orientation="vertical"
        className="m-0 hidden h-full w-px border-0 bg-line lg:block"
      />
      {children}
    </div>
  );
}
