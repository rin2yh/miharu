import { afterEach, describe, expect, it, vi } from "vitest";
import { NORMALIZED_STATUSES } from "../../domain";
import type { IncidentState, NormalizedStatus } from "../../domain";
import {
  formatDateTime,
  incidentKindLabel,
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
    { kind: "incident", state: "investigating", lifecycle: "active", label: "調査中" },
    { kind: "incident", state: "identified", lifecycle: "active", label: "対応中" },
    { kind: "incident", state: "monitoring", lifecycle: "active", label: "監視中" },
    { kind: "incident", state: "scheduled", lifecycle: "active", label: "予定" },
    { kind: "incident", state: "in_progress", lifecycle: "active", label: "対応中" },
    { kind: "incident", state: "resolved", lifecycle: "active", label: "復旧済み" },
    {
      kind: "maintenance",
      state: "scheduled",
      lifecycle: "active",
      label: "予定",
    },
    {
      kind: "maintenance",
      state: "in_progress",
      lifecycle: "active",
      label: "実施中",
    },
    { kind: "maintenance", state: "investigating", lifecycle: "active", label: "実施中" },
    { kind: "maintenance", state: "identified", lifecycle: "active", label: "実施中" },
    { kind: "maintenance", state: "monitoring", lifecycle: "active", label: "実施中" },
    { kind: "maintenance", state: "resolved", lifecycle: "active", label: "完了" },
  ] as const)("labels $kind $state as $label", ({ kind, state, lifecycle, label }) => {
    expect(incidentStateLabel(kind, state as IncidentState, lifecycle)).toBe(label);
  });

  it.each([
    { kind: "incident", label: "障害" },
    { kind: "maintenance", label: "メンテナンス" },
  ] as const)("labels the $kind kind separately", ({ kind, label }) => {
    expect(incidentKindLabel(kind)).toBe(label);
  });

  it.each([
    { kind: "incident", label: "状態不明" },
    { kind: "maintenance", label: "状態不明" },
  ] as const)("labels an unknown $kind state independently", ({ kind, label }) => {
    expect(incidentStateLabel(kind, "unrecognized" as IncidentState, "active")).toBe(label);
  });

  it.each([
    { kind: "incident", state: "investigating", label: "調査中・再確認不能" },
    { kind: "maintenance", state: "scheduled", label: "予定・再確認不能" },
    { kind: "incident", state: "unknown", label: "状態不明・再確認不能" },
  ] as const)(
    "shows the last official $kind state beside a failed recheck",
    ({ kind, state, label }) => {
      expect(incidentStateLabel(kind, state, "unverified")).toBe(label);
    },
  );

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
