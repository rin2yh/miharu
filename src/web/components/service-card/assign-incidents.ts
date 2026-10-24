import type { DashboardIncident, DashboardService } from "../../../domain";
import { isAbnormal } from "../../presentation/status-presentation";

export function assignIncidents(service: DashboardService): {
  assigned: Map<string, DashboardIncident[]>;
  unassigned: DashboardIncident[];
} {
  const assigned = new Map<string, DashboardIncident[]>();
  const knownComponents = new Map(service.components.map((component) => [component.id, component]));
  const unassigned: DashboardIncident[] = [];
  const seenIncidentIds = new Set<string>();

  for (const incident of service.incidents) {
    if (seenIncidentIds.has(incident.id)) continue;
    seenIncidentIds.add(incident.id);

    const matchedIds = incident.componentIds.filter((id) => knownComponents.has(id));
    const matchedComponents =
      matchedIds.length > 0
        ? matchedIds.map((id) => knownComponents.get(id)!)
        : service.components.filter((component) => incident.components.includes(component.name));
    if (matchedComponents.length === 0) {
      unassigned.push(incident);
      continue;
    }
    const component =
      matchedComponents.find((candidate) => isAbnormal(candidate.status)) ?? matchedComponents[0]!;
    const list = assigned.get(component.id) ?? [];
    list.push(incident);
    assigned.set(component.id, list);
  }

  return { assigned, unassigned };
}
