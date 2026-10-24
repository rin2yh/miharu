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
    { kind: "incident", state: "investigating", lifecycle: "active", label: "障害・調査中" },
    { kind: "incident", state: "identified", lifecycle: "active", label: "障害・対応中" },
    { kind: "incident", state: "monitoring", lifecycle: "active", label: "障害・監視中" },
    { kind: "incident", state: "scheduled", lifecycle: "active", label: "障害・予定" },
    { kind: "incident", state: "resolved", lifecycle: "resolved", label: "障害・復旧" },
    {
      kind: "maintenance",
      state: "scheduled",
      lifecycle: "active",
      sourceStatus: "scheduled",
      label: "メンテナンス予定",
    },
    {
      kind: "maintenance",
      state: "scheduled",
      lifecycle: "active",
      sourceStatus: "in_progress",
      label: "メンテナンス中",
    },
    {
      kind: "maintenance",
      state: "scheduled",
      lifecycle: "active",
      sourceStatus: "in_progress_maintenance",
      label: "メンテナンス中",
    },
    { kind: "maintenance", state: "investigating", lifecycle: "active", label: "メンテナンス中" },
    { kind: "maintenance", state: "identified", lifecycle: "active", label: "メンテナンス中" },
    { kind: "maintenance", state: "monitoring", lifecycle: "active", label: "メンテナンス中" },
    {
      kind: "maintenance",
      state: "resolved",
      lifecycle: "resolved",
      sourceStatus: "completed",
      label: "メンテナンス完了",
    },
  ] as const)(
    "labels $kind $state/$sourceStatus as $label",
    ({ kind, state, lifecycle, sourceStatus, label }) => {
      expect(
        incidentStateLabel(kind, state as DashboardIncident["state"], lifecycle, sourceStatus),
      ).toBe(label);
    },
  );

  it.each([
    { kind: "incident", lifecycle: "active", label: "障害・状態不明" },
    { kind: "maintenance", lifecycle: "active", label: "メンテナンス・状態不明" },
  ] as const)("keeps $kind in an unknown state label", ({ kind, lifecycle, label }) => {
    expect(incidentStateLabel(kind, "unrecognized" as DashboardIncident["state"], lifecycle)).toBe(
      label,
    );
  });

  it.each([
    { kind: "incident", label: "障害・確認不能" },
    { kind: "maintenance", label: "メンテナンス・確認不能" },
  ] as const)("labels an unverified $kind as $label", ({ kind, label }) => {
    expect(incidentStateLabel(kind, "investigating", "unverified")).toBe(label);
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
