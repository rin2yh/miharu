import { describe, expect, it } from "vitest";
import { normalizeStatus } from "./index";

describe("normalizeStatus", () => {
  it.each([
    ["ok", "operational"],
    ["none", "operational"],
    ["operational", "operational"],
    ["minor", "degraded_performance"],
    ["degraded_performance", "degraded_performance"],
    ["major", "partial_outage"],
    ["partial_outage", "partial_outage"],
    ["critical", "major_outage"],
    ["major_outage", "major_outage"],
    ["under_maintenance", "under_maintenance"],
    ["active", "unknown"],
    [null, "unknown"],
  ] as const)("maps %s into %s", (source, expected) => {
    expect(normalizeStatus(source)).toBe(expected);
  });
});
