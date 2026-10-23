import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type { DashboardPayload, DashboardService } from "../domain";
import { App } from "./App";

const lastSuccessAt = "2026-10-23T05:00:00.000Z";

function service(overrides: Partial<DashboardService> = {}): DashboardService {
  return {
    id: "github",
    name: "GitHub",
    statusPageUrl: "https://www.githubstatus.com/",
    status: "operational",
    sourceStatus: "none",
    summary: null,
    lastSuccessAt,
    hasFetchError: false,
    isStale: false,
    components: [],
    incidents: [],
    ...overrides,
  };
}

function incident(overrides: Partial<DashboardService["incidents"][number]> = {}) {
  return {
    id: "incident-1",
    title: "Messaging delays for some users",
    body: "We are investigating.",
    kind: "incident" as const,
    state: "investigating" as const,
    sourceStatus: "investigating",
    sourceType: "incident",
    sourceImpact: null,
    severityStatus: "partial_outage" as const,
    componentIds: [],
    components: ["Messaging"],
    officialCreatedAt: "2026-10-23T04:50:00.000Z",
    officialUpdatedAt: "2026-10-23T04:55:00.000Z",
    url: "https://www.githubstatus.com/incidents/incident-1",
    ...overrides,
  };
}

function payload(services: DashboardService[]): DashboardPayload {
  return {
    generatedAt: lastSuccessAt,
    freshnessWarningSeconds: 180,
    services,
    recentEvents: [],
  };
}

const basePayload = payload([
  service({
    id: "slack",
    name: "Slack",
    statusPageUrl: "https://slack-status.com/",
    sourceStatus: "ok",
    incidents: [incident()],
  }),
  service(),
]);

describe("dashboard", () => {
  it("links each service name to its official status page and shows incidents without a component catalogue", async () => {
    render(<App load={async () => basePayload} />);

    expect(await screen.findByText("Messaging delays for some users")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Slack" })).toHaveAttribute(
      "href",
      "https://slack-status.com/",
    );
    const slackCard = screen.getByRole("link", { name: "Slack" }).closest("li");
    expect(slackCard).not.toBeNull();
    expect(within(slackCard!).getByText("正常")).toBeInTheDocument();
    expect(
      within(slackCard!).getByText("独立したコンポーネント状態は公式APIから提供されていません。"),
    ).toBeInTheDocument();
    expect(within(slackCard!).getByText("障害の重要度: 部分障害")).toBeInTheDocument();
    expect(slackCard?.querySelector('time[datetime="2026-10-23T04:50:00.000Z"]')).not.toBeNull();
  });

  it("keeps service status official and sorts components while grouping every incident once", async () => {
    const github = service({
      status: "operational",
      components: [
        {
          id: "web",
          name: "Web",
          status: "degraded_performance",
          sourceStatus: "minor",
          lastChangedAt: lastSuccessAt,
        },
        {
          id: "packages",
          name: "Packages",
          status: "operational",
          sourceStatus: "operational",
          lastChangedAt: lastSuccessAt,
        },
        {
          id: "actions",
          name: "Actions",
          status: "degraded_performance",
          sourceStatus: "minor",
          lastChangedAt: lastSuccessAt,
        },
        {
          id: "issues",
          name: "Issues",
          status: "major_outage",
          sourceStatus: "major_outage",
          lastChangedAt: lastSuccessAt,
        },
      ],
      incidents: [
        incident({ id: "actions-1", title: "Actions delay", componentIds: ["actions"] }),
        incident({ id: "actions-2", title: "Workflow queue delay", componentIds: ["actions"] }),
        incident({
          id: "package-1",
          title: "Package notice",
          componentIds: [],
          components: ["Packages"],
        }),
        incident({
          id: "orphan-1",
          title: "Unmatched incident",
          componentIds: ["removed-id"],
          components: ["Removed component"],
        }),
      ],
    });
    render(<App load={async () => payload([github])} />);

    const card = (await screen.findByRole("link", { name: "GitHub" })).closest("li");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".service-card-title .status-pill")?.textContent).toContain("正常");
    const componentRows = [...card!.querySelectorAll(".component-accordion")];
    expect(
      componentRows.map((row) => row.querySelector(".component-summary-name")?.textContent),
    ).toEqual(["Issues", "Actions", "Web", "Packages"]);

    const issueDetails = componentRows[0]?.querySelector("details");
    const actionsDetails = componentRows[1]?.querySelector("details");
    const packagesDetails = componentRows[3]?.querySelector("details");
    expect(issueDetails?.open).toBe(true);
    expect(actionsDetails?.open).toBe(true);
    expect(packagesDetails?.open).toBe(false);
    expect(within(componentRows[1]!).getByText("障害情報 2件")).toBeInTheDocument();
    expect(within(componentRows[3]!).getByText("障害情報 1件")).toBeInTheDocument();
    expect(within(componentRows[1]!).getByText("Actions delay")).toBeInTheDocument();
    expect(within(componentRows[1]!).getByText("Workflow queue delay")).toBeInTheDocument();
    expect(screen.getAllByText("Unmatched incident")).toHaveLength(1);
    expect(screen.getByText("コンポーネントに関連付けられていない情報")).toBeInTheDocument();

    fireEvent.click(componentRows[3]!.querySelector("summary")!);
    expect(packagesDetails?.open).toBe(true);
    expect(within(componentRows[3]!).getByText("Package notice")).toBeInTheDocument();
  });

  it("shows the official service outage separately from component outage", async () => {
    const affected = service({
      status: "major_outage",
      sourceStatus: "major_outage",
      components: [
        {
          id: "actions",
          name: "Actions",
          status: "major_outage",
          sourceStatus: "major_outage",
          lastChangedAt: lastSuccessAt,
        },
      ],
    });
    render(<App load={async () => payload([affected])} />);

    const card = (await screen.findByRole("link", { name: "GitHub" })).closest("li");
    expect(card).not.toBeNull();
    expect(within(card!).getAllByText("全面障害")).toHaveLength(2);
    expect(within(card!).getByText("公式サービス全体")).toBeInTheDocument();
    expect(within(card!).getByText("Actions")).toBeInTheDocument();
  });

  it("shows errors without replacing the last loaded snapshot", async () => {
    const load = vi
      .fn<() => Promise<DashboardPayload>>()
      .mockResolvedValueOnce(basePayload)
      .mockRejectedValueOnce(new Error("unavailable"));
    render(<App load={load} />);
    expect(await screen.findByText("Messaging delays for some users")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "手動更新" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("表示中の情報は保持しています");
    expect(screen.getByText("Messaging delays for some users")).toBeInTheDocument();
  });

  it("shows incident updates and removes the incident after recovery", async () => {
    const updatedPayload = payload(
      basePayload.services.map((item) => ({
        ...item,
        incidents: item.incidents.map((current) => ({
          ...current,
          title: "Messaging is recovering",
        })),
      })),
    );
    const recoveredPayload = payload(
      basePayload.services.map((item) => ({ ...item, incidents: [] })),
    );
    const load = vi
      .fn<() => Promise<DashboardPayload>>()
      .mockResolvedValueOnce(basePayload)
      .mockResolvedValueOnce(updatedPayload)
      .mockResolvedValueOnce(recoveredPayload);
    render(<App load={load} />);
    expect(await screen.findByText("Messaging delays for some users")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "手動更新" }));
    expect(await screen.findByText("Messaging is recovering")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "手動更新" }));
    await waitFor(() =>
      expect(screen.queryByText("Messaging is recovering")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Slack" })).toBeInTheDocument();
  });

  it("filters services by name and clears the query", async () => {
    render(<App load={async () => basePayload} />);
    await screen.findByRole("link", { name: "GitHub" });
    fireEvent.change(screen.getByRole("searchbox", { name: "サービスを検索" }), {
      target: { value: "slack" },
    });
    expect(screen.getByRole("link", { name: "Slack" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GitHub" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "検索をクリア" }));
    expect(screen.getByRole("link", { name: "GitHub" })).toBeInTheDocument();
  });

  it("loads on entry and polls once per minute", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn<() => Promise<DashboardPayload>>(async () => basePayload);
      render(<App load={load} />);
      await act(async () => await Promise.resolve());
      expect(load).toHaveBeenCalledTimes(1);
      await act(async () => await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_INTERVAL_MS));
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes stale information visible", async () => {
    const stalePayload = payload(basePayload.services.map((item) => ({ ...item, isStale: true })));
    render(<App load={async () => stalePayload} />);
    expect(await screen.findAllByText(/情報が古い可能性があります/)).toHaveLength(2);
  });
});
