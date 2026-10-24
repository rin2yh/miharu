import { afterEach, describe, expect, it, vi } from "vitest";
import { NORMALIZED_STATUSES } from "../../domain";
import type { DashboardIncident, NormalizedStatus } from "../../domain";
import {
  formatDateTime,
  incidentStateLabel,
  isAbnormal,
  relativeTime,
  servicePriority,
  STATUS_LABELS,
  STATUS_RANK,
} from "./status-presentation";
import { component, incident, service } from "../test-fixtures";

afterEach(() => vi.useRealTimers());

describe("status presentation", () => {
  it.each(NORMALIZED_STATUSES)("labels %s and identifies whether it is abnormal", (status) => {
    expect(STATUS_LABELS[status]).toBeTruthy();
    expect(isAbnormal(status)).toBe(status !== "operational");
  });

  it.each([
    ["investigating", "調査中"],
    ["identified", "原因特定"],
    ["monitoring", "復旧確認中"],
    ["scheduled", "予定・実施中"],
    ["resolved", "復旧"],
  ] as const)("labels incident state %s", (state, label) => {
    expect(incidentStateLabel(state, "active")).toBe(label);
  });

  it("uses a fallback label for an unrecognized incident state", () => {
    expect(incidentStateLabel("unrecognized" as DashboardIncident["state"], "active")).toBe(
      "状態不明",
    );
  });

  it("labels an unverified incident as unverifiable", () => {
    expect(incidentStateLabel("investigating", "unverified")).toBe("確認不能");
  });

  it("formats valid dates and identifies invalid dates", () => {
    expect(formatDateTime("2026-10-23T04:50:00.000Z")).not.toBe("時刻不明");
    expect(formatDateTime("not-a-date")).toBe("時刻不明");
  });

  it.each([
    { minutesAgo: 0, label: "1分未満" },
    { minutesAgo: -3, label: "1分未満" },
    { minutesAgo: 1, label: "1分" },
    { minutesAgo: 59, label: "59分" },
    { minutesAgo: 60, label: "1時間" },
    { minutesAgo: 1_439, label: "23時間" },
    { minutesAgo: 1_440, label: "1日" },
  ])("formats a timestamp $minutesAgo minutes from now", ({ minutesAgo, label }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T00:00:00.000Z"));
    const timestamp = new Date(Date.now() - minutesAgo * 60_000).toISOString();

    expect(relativeTime(timestamp)).toBe(label);
  });

  it("handles an invalid relative timestamp", () => {
    expect(relativeTime("not-a-date")).toBe("時刻不明");
  });

  it.each([
    {
      name: "service status",
      input: service({ status: "partial_outage" }),
      expected: STATUS_RANK.partial_outage,
    },
    {
      name: "component status",
      input: service({ components: [component("api", "API", "degraded_performance")] }),
      expected: STATUS_RANK.degraded_performance,
    },
    {
      name: "incident severity",
      input: service({ incidents: [incident({ severityStatus: "major_outage" })] }),
      expected: STATUS_RANK.major_outage,
    },
    {
      name: "the highest of all statuses",
      input: service({
        status: "degraded_performance",
        components: [component("api", "API", "partial_outage")],
        incidents: [incident({ severityStatus: "major_outage" })],
      }),
      expected: STATUS_RANK.major_outage,
    },
    {
      name: "unknown and operational statuses",
      input: service({
        status: "unknown",
        components: [component("api", "API", "operational")],
        incidents: [incident({ severityStatus: "unknown" })],
      }),
      expected: 0,
    },
  ])("uses $name when ordering services", ({ input, expected }) => {
    expect(servicePriority(input)).toBe(expected);
  });

  it("ranks maintenance below an active service degradation", () => {
    const maintenance: NormalizedStatus = "under_maintenance";
    expect(servicePriority(service({ status: maintenance }))).toBe(STATUS_RANK[maintenance]);
  });
});
