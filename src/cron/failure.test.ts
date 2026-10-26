import { describe, expect, it } from "vitest";
import { applyFailureMetadata, failureMetadata } from "./failure";

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
