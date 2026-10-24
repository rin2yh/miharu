import { useState } from "react";
import type { DashboardComponent, DashboardIncident, NormalizedStatus } from "../../../domain";
import { isAbnormal, STATUS_LABELS, STATUS_RANK } from "../../presentation/status-presentation";
import { IncidentList } from "./incident-list";

export const statusColors: Record<NormalizedStatus, string> = {
  operational: "bg-healthy-bg text-healthy",
  degraded_performance: "bg-degraded-bg text-degraded",
  partial_outage: "bg-partial-bg text-partial",
  major_outage: "bg-outage-bg text-outage",
  under_maintenance: "bg-maintenance-bg text-maintenance",
  unknown: "bg-unknown-bg text-unknown",
};

interface ComponentListProps {
  serviceId: string;
  serviceName: string;
  components: DashboardComponent[];
  assignedIncidents: Map<string, DashboardIncident[]>;
}

export function ComponentList({
  serviceId,
  serviceName,
  components: sourceComponents,
  assignedIncidents,
}: ComponentListProps) {
  const [showHealthyComponents, setShowHealthyComponents] = useState(false);
  const [showUnknownComponents, setShowUnknownComponents] = useState(false);
  const components = sourceComponents.toSorted((left, right) => {
    const abnormalDifference = Number(isAbnormal(right.status)) - Number(isAbnormal(left.status));
    const statusDifference = STATUS_RANK[right.status] - STATUS_RANK[left.status];
    return (
      abnormalDifference ||
      statusDifference ||
      left.name.localeCompare(right.name, "ja") ||
      left.id.localeCompare(right.id)
    );
  });
  // Keep a component visible when it owns an incident, even if its status is healthy or unknown.
  const visibleComponents = components.filter(
    (component) =>
      (component.status !== "operational" &&
        (component.status !== "unknown" || component.sourceStatus === "affected")) ||
      (assignedIncidents.get(component.id)?.length ?? 0) > 0,
  );
  const healthyComponents = components.filter(
    (component) =>
      component.status === "operational" &&
      (assignedIncidents.get(component.id)?.length ?? 0) === 0,
  );
  const unknownComponents = components.filter(
    (component) =>
      component.status === "unknown" &&
      component.sourceStatus !== "affected" &&
      (assignedIncidents.get(component.id)?.length ?? 0) === 0,
  );
  const healthyComponentsId = `healthy-components-${serviceId}`;
  const unknownComponentsId = `unknown-components-${serviceId}`;

  if (components.length === 0) {
    return (
      <section className="mt-2.5" aria-label={`${serviceName}のコンポーネント`}>
        <h3 className="mt-0 mb-1 text-xs font-semibold text-muted">コンポーネント</h3>
        <p className="mt-0 mb-1 text-xs leading-relaxed text-muted">
          コンポーネント単位の状態情報は提供されていません。
        </p>
      </section>
    );
  }

  return (
    <section className="mt-2.5" aria-label={`${serviceName}のコンポーネント`}>
      <h3 className="mt-0 mb-1 text-xs font-semibold text-muted">コンポーネント</h3>
      <div>
        {visibleComponents.length > 0 && (
          <ul className="m-0 list-none p-0" aria-label="表示中のコンポーネント">
            {visibleComponents.map((component) => (
              <ComponentItem
                key={component.id}
                component={component}
                incidents={assignedIncidents.get(component.id) ?? []}
              />
            ))}
          </ul>
        )}
        {healthyComponents.length > 0 && (
          <>
            <button
              className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-line bg-transparent px-0.5 py-2 text-left text-xs font-semibold text-healthy underline-offset-2 hover:underline"
              type="button"
              aria-expanded={showHealthyComponents}
              aria-controls={healthyComponentsId}
              onClick={() => setShowHealthyComponents((visible) => !visible)}
            >
              <DisclosureArrow expanded={showHealthyComponents} />
              {showHealthyComponents
                ? "正常なコンポーネントを非表示"
                : `正常なコンポーネント ${healthyComponents.length}件を表示`}
            </button>
            <ul
              className="m-0 list-none p-0"
              id={healthyComponentsId}
              aria-label="正常なコンポーネント"
              hidden={!showHealthyComponents}
            >
              {healthyComponents.map((component) => (
                <ComponentItem
                  key={component.id}
                  component={component}
                  incidents={assignedIncidents.get(component.id) ?? []}
                />
              ))}
            </ul>
          </>
        )}
        {unknownComponents.length > 0 && (
          <>
            <p className="mt-1 mb-1 text-xs leading-relaxed text-muted">
              個別の稼働状態が公開されていない機能は、状態不明としてまとめています。
            </p>
            <button
              className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-line bg-transparent px-0.5 py-2 text-left text-xs font-semibold text-unknown underline-offset-2 hover:underline"
              type="button"
              aria-expanded={showUnknownComponents}
              aria-controls={unknownComponentsId}
              onClick={() => setShowUnknownComponents((visible) => !visible)}
            >
              <DisclosureArrow expanded={showUnknownComponents} />
              {showUnknownComponents
                ? "状態不明のコンポーネントを非表示"
                : `状態不明のコンポーネント ${unknownComponents.length}件を表示`}
            </button>
            <ul
              className="m-0 list-none p-0"
              id={unknownComponentsId}
              aria-label="状態不明のコンポーネント"
              hidden={!showUnknownComponents}
            >
              {unknownComponents.map((component) => (
                <ComponentItem key={component.id} component={component} incidents={[]} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function DisclosureArrow({ expanded }: { expanded: boolean }) {
  return (
    <span
      className={`w-3 shrink-0 text-center text-lg leading-none text-quiet transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      ›
    </span>
  );
}

function ComponentItem({
  component,
  incidents,
}: {
  component: DashboardComponent;
  incidents: DashboardIncident[];
}) {
  const label =
    component.sourceStatus === "affected" ? "影響あり・程度不明" : STATUS_LABELS[component.status];

  return (
    <li className="border-t border-line" aria-label={`${component.name}コンポーネント`}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-2 px-0.5 py-2 text-xs text-ink max-sm:gap-1.5">
        <h4 className="m-0 min-w-0 [overflow-wrap:anywhere] font-semibold">{component.name}</h4>
        <span
          className={`inline-flex min-h-6 items-center gap-2 whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold ${statusColors[component.status]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {label}
        </span>
      </div>
      {incidents.length > 0 && <IncidentList incidents={incidents} nested />}
    </li>
  );
}
