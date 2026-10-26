import { afterEach, describe, expect, it, vi } from "vitest";
import { NORMALIZED_STATUSES } from "../../domain";
import type { IncidentState } from "../../domain";
import {
  formatDateTime,
  incidentCategoryLabel,
  incidentStateLabel,
  isAbnormal,
  relativeTime,
  STATUS_LABELS,
} from "./status-presentation";

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
    { kind: "outage", label: "障害" },
    { kind: "maintenance", label: "メンテナンス" },
  ] as const)("labels the $kind kind separately", ({ kind, label }) => {
    expect(incidentCategoryLabel(kind)).toBe(label);
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
});
