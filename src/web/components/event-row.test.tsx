import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DashboardEvent } from "../../domain";
import { EventRow } from "./event-row";

const labels = [
  { kind: "incident", eventKind: "opened", label: "障害発生" },
  { kind: "incident", eventKind: "updated", label: "障害更新" },
  { kind: "incident", eventKind: "resolved", label: "復旧" },
  { kind: "maintenance", eventKind: "opened", label: "メンテナンス予定" },
  { kind: "maintenance", eventKind: "updated", label: "メンテナンス更新" },
  { kind: "maintenance", eventKind: "resolved", label: "メンテナンス完了" },
] as const;

function event(overrides: Partial<DashboardEvent> = {}): DashboardEvent {
  return {
    id: "event-1",
    serviceId: "github",
    serviceName: "GitHub",
    incidentId: "incident-1",
    title: "Actions delay",
    kind: "incident",
    eventKind: "opened",
    sourceStatus: "investigating",
    severityStatus: "partial_outage",
    detectedAt: "2026-10-23T05:00:00.000Z",
    officialEventAt: "2026-10-23T04:50:00.000Z",
    url: "https://www.githubstatus.com/incidents/incident-1",
    ...overrides,
  };
}

describe("EventRow", () => {
  it.each(labels)("labels $kind $eventKind events as $label", ({ kind, eventKind, label }) => {
    render(<EventRow event={event({ kind, eventKind })} />);

    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Actions delay" })).toHaveAttribute(
      "href",
      "https://www.githubstatus.com/incidents/incident-1",
    );
    expect(screen.getByText(/公式時刻/)).toBeInTheDocument();
  });

  it("shows the title without a link or official time when those details are absent", () => {
    render(<EventRow event={event({ url: null, officialEventAt: null })} />);

    expect(screen.getByText("Actions delay")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Actions delay" })).not.toBeInTheDocument();
    expect(screen.queryByText(/公式時刻/)).not.toBeInTheDocument();
  });
});
