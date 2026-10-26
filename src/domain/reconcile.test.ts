import { describe, expect, it } from "vitest";
import type { NormalizedIncident } from "./index";
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
    ...overrides,
  };
}

describe("incident reconciliation", () => {
  it("records an incident once when it first appears", () => {
    const result = reconcileIncidents("github", [], [incident()], observedAt);
    expect(result.changedIncidents).toHaveLength(1);
    expect(result.changedIncidents[0]).toMatchObject({
      revision: 1,
      lifecycle: "active",
      closureReason: null,
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

  it("keeps an unknown official status active instead of marking it unverified", () => {
    const result = reconcileIncidents(
      "github",
      [],
      [incident({ state: "unknown", sourceStatus: "future_status" })],
      observedAt,
    );

    expect(result.changedIncidents[0]).toMatchObject({
      state: "unknown",
      sourceStatus: "future_status",
      lifecycle: "active",
      closureReason: null,
    });
  });

  it("records an official recovery separately from tracking lifecycle", () => {
    const existing = reconcileIncidents("github", [], [incident()], observedAt).changedIncidents;
    const recovered = incident({
      state: "resolved",
      sourceStatus: "resolved",
      officialUpdatedAt: "2026-10-23T05:15:00.000Z",
      body: "The issue has been resolved.",
    });
    const result = reconcileIncidents("github", existing, [recovered], "2026-10-23T05:16:00.000Z");
    expect(result.changedIncidents[0]).toMatchObject({
      state: "resolved",
      lifecycle: "closed",
      closureReason: "official_resolved",
      closedDetectedAt: "2026-10-23T05:16:00.000Z",
    });
    expect(result.events[0]).toMatchObject({
      eventKind: "resolved",
      closureReason: "official_resolved",
      officialEventAt: "2026-10-23T05:15:00.000Z",
      detectedAt: "2026-10-23T05:16:00.000Z",
    });
  });

  it("closes a missing incident without rewriting its last official state", () => {
    const existing = reconcileIncidents(
      "slack",
      [],
      [incident({ url: null })],
      observedAt,
    ).changedIncidents;
    const detectedAt = "2026-10-23T05:10:00.000Z";
    const result = reconcileIncidents("slack", existing, [], detectedAt);
    expect(result.changedIncidents[0]).toMatchObject({
      state: "investigating",
      sourceStatus: "investigating",
      lifecycle: "closed",
      closureReason: "no_longer_listed",
      closedDetectedAt: detectedAt,
    });
    expect(result.events[0]).toMatchObject({
      eventKind: "closed",
      closureReason: "no_longer_listed",
      state: "investigating",
      sourceStatus: "investigating",
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

  it("keeps the last official state when a recheck fails", () => {
    const active = reconcileIncidents(
      "google-workspace",
      [],
      [incident()],
      observedAt,
    ).changedIncidents;
    const result = reconcileIncidents(
      "google-workspace",
      active,
      [],
      "2026-10-23T05:05:00.000Z",
      false,
      ["incident-1"],
    );

    expect(result.changedIncidents).toMatchObject([
      {
        lifecycle: "unverified",
        closureReason: null,
        closedDetectedAt: null,
        state: "investigating",
        sourceStatus: "investigating",
        revision: 2,
      },
    ]);
    expect(result.events).toEqual([]);
  });

  it("reconfirms an unverified incident without creating a duplicate open event", () => {
    const active = reconcileIncidents(
      "google-workspace",
      [],
      [incident()],
      observedAt,
    ).changedIncidents;
    const unverified = reconcileIncidents(
      "google-workspace",
      active,
      [],
      "2026-10-23T05:05:00.000Z",
      false,
      ["incident-1"],
    ).changedIncidents;
    const result = reconcileIncidents(
      "google-workspace",
      unverified,
      [incident()],
      "2026-10-23T05:10:00.000Z",
      false,
    );

    expect(result.changedIncidents).toMatchObject([
      { lifecycle: "active", closureReason: null, state: "investigating", revision: 3 },
    ]);
    expect(result.events).toEqual([]);
  });

  it("records recovery when an unverified incident is confirmed resolved", () => {
    const active = reconcileIncidents(
      "google-workspace",
      [],
      [incident()],
      observedAt,
    ).changedIncidents;
    const unverified = reconcileIncidents(
      "google-workspace",
      active,
      [],
      "2026-10-23T05:05:00.000Z",
      false,
      ["incident-1"],
    ).changedIncidents;
    const result = reconcileIncidents(
      "google-workspace",
      unverified,
      [incident({ state: "resolved", sourceStatus: "resolved" })],
      "2026-10-23T05:10:00.000Z",
      false,
    );

    expect(result.changedIncidents).toMatchObject([
      {
        lifecycle: "closed",
        closureReason: "official_resolved",
        closedDetectedAt: "2026-10-23T05:10:00.000Z",
        revision: 3,
      },
    ]);
    expect(result.events).toMatchObject([
      { eventKind: "resolved", closureReason: "official_resolved" },
    ]);
  });

  it("does not add historical events for resolved incidents first seen in an incomplete list", () => {
    const result = reconcileIncidents(
      "chatgpt",
      [],
      [incident({ state: "resolved", sourceStatus: "resolved" })],
      observedAt,
      false,
    );

    expect(result.changedIncidents).toMatchObject([
      { lifecycle: "closed", closureReason: "official_resolved", revision: 1 },
    ]);
    expect(result.events).toEqual([]);
  });

  it("records an explicit resolution found in an incomplete list", () => {
    const existing = reconcileIncidents("chatgpt", [], [incident()], observedAt).changedIncidents;
    const recovered = incident({
      state: "resolved",
      sourceStatus: "resolved",
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

    expect(result.changedIncidents[0]).toMatchObject({
      lifecycle: "closed",
      closureReason: "official_resolved",
      sourceStatus: "resolved",
    });
    expect(result.events[0]).toMatchObject({
      eventKind: "resolved",
      officialEventAt: "2026-10-23T05:15:00.000Z",
    });
  });

  it("reopens an incident closed by disappearance when it is listed again", () => {
    const resolved = reconcileIncidents("github", [], [incident()], observedAt).changedIncidents;
    const closed = reconcileIncidents("github", resolved, [], "2026-10-23T05:05:00.000Z");
    const reopened = reconcileIncidents(
      "github",
      closed.changedIncidents,
      [incident()],
      "2026-10-23T05:10:00.000Z",
    );
    expect(reopened.changedIncidents[0]).toMatchObject({
      lifecycle: "active",
      closureReason: null,
      revision: closed.changedIncidents[0]!.revision + 1,
    });
    expect(reopened.events[0]?.eventKind).toBe("opened");
  });

  it("keeps officially resolved first-seen incidents closed without inventing an open event for incomplete history", () => {
    const result = reconcileIncidents(
      "chatgpt",
      [],
      [incident({ state: "resolved", sourceStatus: "resolved" })],
      observedAt,
      false,
    );

    expect(result.changedIncidents[0]).toMatchObject({
      lifecycle: "closed",
      closureReason: "official_resolved",
    });
    expect(result.events).toEqual([]);
  });

  it("deduplicates retries using the same incident revision key", () => {
    const first = reconcileIncidents("github", [], [incident()], observedAt);
    const retried = reconcileIncidents("github", [], [incident()], observedAt);
    expect(first.events[0]?.id).toBe(retried.events[0]?.id);
  });
});
