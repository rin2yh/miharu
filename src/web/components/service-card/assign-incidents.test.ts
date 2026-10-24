import { describe, expect, it } from "vitest";
import { component, incident, service } from "../../test-fixtures";
import { assignIncidents } from "./assign-incidents";

describe("assignIncidents", () => {
  it.each([
    {
      name: "component IDs",
      componentIds: ["actions"],
      components: ["API Requests"],
      expectedComponentId: "actions",
    },
    {
      name: "component names when no ID matches",
      componentIds: ["removed-id"],
      components: ["API Requests"],
      expectedComponentId: "api",
    },
  ])("assigns incidents using $name", ({ componentIds, components, expectedComponentId }) => {
    const expectedIncident = incident({ componentIds, components });
    const result = assignIncidents(
      service({
        components: [
          component("actions", "Actions", "partial_outage"),
          component("api", "API Requests"),
        ],
        incidents: [expectedIncident],
      }),
    );

    expect(result.assigned.get(expectedComponentId)).toEqual([expectedIncident]);
    expect(result.unassigned).toEqual([]);
  });

  it("assigns an incident to an abnormal component among several matches", () => {
    const expectedIncident = incident({
      componentIds: ["api", "actions"],
      components: ["Actions", "API"],
    });
    const result = assignIncidents(
      service({
        components: [component("actions", "Actions", "partial_outage"), component("api", "API")],
        incidents: [expectedIncident],
      }),
    );

    expect(result.assigned.get("actions")).toEqual([expectedIncident]);
    expect(result.assigned.has("api")).toBe(false);
  });

  it("keeps unmatched incidents separate and removes duplicate IDs", () => {
    const unmatchedIncident = incident({
      id: "orphan-1",
      title: "Unmatched incident",
      componentIds: ["removed-id"],
    });
    const duplicateIncident = incident({
      id: "orphan-1",
      title: "Duplicate incident",
      componentIds: ["actions"],
    });
    const result = assignIncidents(
      service({
        components: [component("actions", "Actions", "degraded_performance")],
        incidents: [unmatchedIncident, duplicateIncident],
      }),
    );

    expect(result.unassigned).toEqual([unmatchedIncident]);
    expect(result.assigned.size).toBe(0);
  });
});
