import { describe, expect, it } from "vitest";
import type { IncidentState } from "../../domain";
import { parseIncidentState } from "./shared";

const knownIncidentStates = [
  ["resolved", "resolved"],
  ["closed", "resolved"],
  ["complete", "resolved"],
  ["completed", "resolved"],
  ["cancelled", "resolved"],
  ["canceled", "resolved"],
  ["postmortem", "resolved"],
  ["scheduled", "scheduled"],
  ["in_progress", "in_progress"],
  ["in_progress_maintenance", "in_progress"],
  ["monitoring", "monitoring"],
  ["identified", "identified"],
  ["investigating", "investigating"],
  ["active", "investigating"],
  ["open", "investigating"],
] as const satisfies readonly (readonly [string, IncidentState])[];

describe("parseIncidentState", () => {
  it.each(knownIncidentStates)("maps %s to %s", (source, expected) => {
    expect(parseIncidentState(source)).toBe(expected);
  });

  it.each([
    "monitoring_issue",
    "investigation_pending",
    "unknown_status",
    "constructor",
    "__proto__",
  ])("does not infer a state from the unknown value %s", (source) => {
    expect(parseIncidentState(source)).toBe("unknown");
  });

  it("normalizes case, hyphens, and spaces before mapping", () => {
    expect(parseIncidentState("In Progress-Maintenance")).toBe("in_progress");
  });
});
