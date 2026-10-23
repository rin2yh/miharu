import { describe, expect, it } from "vitest";
import type { NormalizedIncident } from "./index";
import { applyFailureMetadata, failureMetadata } from "./failure";
import { reconcileIncidents } from "./reconcile";

const observedAt = "2026-10-23T05:00:00.000Z";

function incident(overrides: Partial<NormalizedIncident> = {}): NormalizedIncident {
  return {
    id: "incident-1",
    title: "API latency",
    body: "Investigating the issue.",
    kind: "incident",
    state: "investigating",
    sourceStatus: "investigating",
    sourceType: null,
    sourceImpact: "major",
    severityStatus: "partial_outage",
    componentIds: [],
    components: ["API"],
    officialCreatedAt: "2026-10-23T04:50:00.000Z",
    officialUpdatedAt: "2026-10-23T04:55:00.000Z",
    url: "https://www.githubstatus.com/incidents/incident-1",
    active: true,
    ...overrides,
  };
}

describe("incident reconciliation", () => {
  it("records an incident once when it first appears", () => {
    const result = reconcileIncidents("github", [], [incident()], observedAt);
    expect(result.changedIncidents).toHaveLength(1);
    expect(result.changedIncidents[0]).toMatchObject({
      revision: 1,
      active: true,
      firstSeenAt: observedAt,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventKind: "opened",
      officialEventAt: incident().officialCreatedAt,
    });
  });

  it("keeps the official event time missing when the source did not provide one", () => {
    const result = reconcileIncidents(
      "slack",
      [],
      [incident({ officialCreatedAt: null })],
      observedAt,
    );
    expect(result.events[0]).toMatchObject({
      detectedAt: observedAt,
      officialEventAt: null,
    });
  });

  it("does not write or create history for an unchanged snapshot", () => {
    const existing = reconcileIncidents("github", [], [incident()], observedAt).changedIncidents;
    const repeated = reconcileIncidents(
      "github",
      existing,
      [incident()],
      "2026-10-23T05:01:00.000Z",
    );
    expect(repeated.changedIncidents).toEqual([]);
    expect(repeated.events).toEqual([]);
  });

  it("records title, body, state, severity, and component changes as one update", () => {
    const existing = reconcileIncidents("github", [], [incident()], observedAt).changedIncidents;
    const changed = incident({
      title: "API errors are elevated",
      body: "We have identified the cause.",
      state: "identified",
      sourceStatus: "identified",
      sourceImpact: "critical",
      severityStatus: "major_outage",
      componentIds: ["component-actions"],
      components: ["API", "Actions"],
      officialUpdatedAt: "2026-10-23T05:04:00.000Z",
    });
    const result = reconcileIncidents("github", existing, [changed], "2026-10-23T05:05:00.000Z");
    expect(result.changedIncidents[0]).toMatchObject({
      revision: 2,
      title: changed.title,
      componentIds: ["component-actions"],
      components: ["API", "Actions"],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventKind: "updated",
      title: changed.title,
      state: "identified",
    });
  });

  it("records an explicit recovery with the official update time", () => {
    const existing = reconcileIncidents("github", [], [incident()], observedAt).changedIncidents;
    const recovered = incident({
      state: "resolved",
      sourceStatus: "resolved",
      active: false,
      officialUpdatedAt: "2026-10-23T05:15:00.000Z",
      body: "The issue has been resolved.",
    });
    const result = reconcileIncidents("github", existing, [recovered], "2026-10-23T05:16:00.000Z");
    expect(result.changedIncidents[0]).toMatchObject({
      active: false,
      resolvedDetectedAt: "2026-10-23T05:16:00.000Z",
    });
    expect(result.events[0]).toMatchObject({
      eventKind: "resolved",
      officialEventAt: "2026-10-23T05:15:00.000Z",
      detectedAt: "2026-10-23T05:16:00.000Z",
    });
  });

  it("detects recovery by disappearance without inventing an official time", () => {
    const existing = reconcileIncidents(
      "slack",
      [],
      [incident({ url: null })],
      observedAt,
    ).changedIncidents;
    const detectedAt = "2026-10-23T05:10:00.000Z";
    const result = reconcileIncidents("slack", existing, [], detectedAt);
    expect(result.changedIncidents[0]).toMatchObject({
      active: false,
      sourceStatus: "not_listed",
      resolvedDetectedAt: detectedAt,
    });
    expect(result.events[0]).toMatchObject({
      eventKind: "resolved",
      officialEventAt: null,
      detectedAt,
    });
  });

  it("does not resolve incidents omitted from an incomplete list", () => {
    const existing = reconcileIncidents("chatgpt", [], [incident()], observedAt).changedIncidents;
    const result = reconcileIncidents("chatgpt", existing, [], "2026-10-23T05:10:00.000Z", false);

    expect(result.changedIncidents).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("does not add historical events for resolved incidents first seen in an incomplete list", () => {
    const result = reconcileIncidents(
      "chatgpt",
      [],
      [incident({ state: "resolved", sourceStatus: "resolved", active: false })],
      observedAt,
      false,
    );

    expect(result.changedIncidents).toMatchObject([{ active: false, revision: 1 }]);
    expect(result.events).toEqual([]);
  });

  it("records an explicit resolution found in an incomplete list", () => {
    const existing = reconcileIncidents("chatgpt", [], [incident()], observedAt).changedIncidents;
    const recovered = incident({
      state: "resolved",
      sourceStatus: "resolved",
      active: false,
      officialUpdatedAt: "2026-10-23T05:15:00.000Z",
      body: "The issue has been resolved.",
    });
    const result = reconcileIncidents(
      "chatgpt",
      existing,
      [recovered],
      "2026-10-23T05:16:00.000Z",
      false,
    );

    expect(result.changedIncidents[0]).toMatchObject({ active: false, sourceStatus: "resolved" });
    expect(result.events[0]).toMatchObject({
      eventKind: "resolved",
      officialEventAt: "2026-10-23T05:15:00.000Z",
    });
  });

  it("tracks a reopened incident as a new revision", () => {
    const resolved = reconcileIncidents(
      "github",
      [],
      [incident({ active: false, state: "resolved" })],
      observedAt,
    ).changedIncidents;
    const reopened = reconcileIncidents(
      "github",
      resolved,
      [incident()],
      "2026-10-23T05:10:00.000Z",
    );
    expect(reopened.changedIncidents[0]?.revision).toBe(resolved[0]!.revision + 1);
    expect(reopened.events[0]?.eventKind).toBe("opened");
  });

  it("deduplicates retries using the same incident revision key", () => {
    const first = reconcileIncidents("github", [], [incident()], observedAt);
    const retried = reconcileIncidents("github", [], [incident()], observedAt);
    expect(first.events[0]?.id).toBe(retried.events[0]?.id);
  });
});

describe("collection failure behavior", () => {
  it("updates only fetch metadata and preserves the last successful service state", () => {
    const previous = {
      status: "partial_outage",
      sourceStatus: "major",
      summary: "Partial outage",
      lastCheckedAt: "2026-10-23T04:59:00.000Z",
      lastSuccessAt: "2026-10-23T04:59:00.000Z",
      lastErrorAt: null,
      errorCode: null,
      incidentTitle: "API latency",
    };
    const after = applyFailureMetadata(
      previous,
      failureMetadata("2026-10-23T05:00:00.000Z", "timeout"),
    );
    expect(after).toMatchObject({
      status: "partial_outage",
      sourceStatus: "major",
      summary: "Partial outage",
      lastSuccessAt: previous.lastSuccessAt,
      incidentTitle: "API latency",
      lastErrorAt: "2026-10-23T05:00:00.000Z",
      errorCode: "timeout",
    });
  });
});
