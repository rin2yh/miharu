import { describe, expect, it } from "vitest";
import { classifyIncident } from "./incident-category";

describe("incident display category", () => {
  it.each([
    ["none", "notice"],
    ["minor", "outage"],
    ["major", "outage"],
    ["critical", "outage"],
    [" MAJOR ", "outage"],
    [null, "unknown"],
    ["future", "unknown"],
    ["", "unknown"],
  ] as const)("classifies impact %s as %s", (sourceImpact, expected) => {
    expect(
      classifyIncident({ kind: "incident", sourceType: "incident", sourceImpact }, "statuspage"),
    ).toBe(expected);
  });

  it("preserves maintenance independently of missing impact", () => {
    expect(classifyIncident({ kind: "maintenance", sourceType: null, sourceImpact: null })).toBe(
      "maintenance",
    );
  });

  it.each([
    ["incident", "outage"],
    ["notice", "notice"],
    [null, "unknown"],
    ["future", "unknown"],
  ] as const)("uses Slack's structured type %s", (sourceType, expected) => {
    expect(classifyIncident({ kind: "incident", sourceType, sourceImpact: null }, "slack")).toBe(
      expected,
    );
  });

  it.each([
    ["SERVICE_INFORMATION", "notice"],
    ["SERVICE_DISRUPTION", "outage"],
    ["SERVICE_OUTAGE", "outage"],
    ["FUTURE", "unknown"],
  ] as const)("uses Google Workspace's structured impact %s", (sourceImpact, expected) => {
    expect(
      classifyIncident(
        { kind: "incident", sourceType: "incident", sourceImpact },
        "google-workspace",
      ),
    ).toBe(expected);
  });

  it("does not treat a generic listing type as outage evidence", () => {
    expect(classifyIncident({ kind: "incident", sourceType: "incident", sourceImpact: null })).toBe(
      "unknown",
    );
  });
});
