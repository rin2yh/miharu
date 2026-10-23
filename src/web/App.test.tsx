import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type { DashboardPayload, DashboardService } from "../domain";
import { App } from "./App";

const lastSuccessAt = "2026-10-23T05:00:00.000Z";
const slackLinkName = "Slackの公式ステータスページを新しいタブで開く";
const githubLinkName = "GitHubの公式ステータスページを新しいタブで開く";
type TestComponent = DashboardService["components"][number];

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

function component(
  id: string,
  name: string,
  status: TestComponent["status"] = "operational",
): TestComponent {
  return { id, name, status, sourceStatus: status, lastChangedAt: lastSuccessAt };
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
    const slackLink = screen.getByRole("link", { name: slackLinkName });
    expect(slackLink).toHaveAttribute("href", "https://slack-status.com/");
    expect(slackLink).toHaveAttribute("target", "_blank");
    const slackCard = slackLink.closest("li");
    expect(slackCard).not.toBeNull();
    expect(within(slackCard!).getAllByRole("link", { name: /公式ステータスページ/ })).toHaveLength(
      1,
    );
    expect(within(slackCard!).queryByRole("link", { name: "公式" })).not.toBeInTheDocument();
    expect(slackLink.closest(".service-card-title")?.querySelector(".status-pill")).not.toBeNull();
    expect(within(slackCard!).getByText("正常")).toBeInTheDocument();
    expect(
      within(slackCard!).getByText("独立したコンポーネント状態は公式APIから提供されていません。"),
    ).toBeInTheDocument();
    expect(
      within(slackCard!).queryByRole("button", { name: /正常なコンポーネント/ }),
    ).not.toBeInTheDocument();
    expect(within(slackCard!).getByText("障害の重要度: 部分障害")).toBeInTheDocument();
    expect(slackCard?.querySelector('time[datetime="2026-10-23T04:50:00.000Z"]')).not.toBeNull();
  });

  it("keeps abnormal components visible, avoids nested disclosures, and shows each incident once", async () => {
    const github = service({
      status: "operational",
      components: [
        component("web", "Web", "degraded_performance"),
        component("packages", "Packages"),
        component("actions", "Actions", "degraded_performance"),
        component("issues", "Issues", "major_outage"),
      ],
      incidents: [
        incident({ id: "actions-1", title: "Actions delay", componentIds: ["actions"] }),
        incident({
          id: "actions-2",
          title: "Workflow queue delay",
          componentIds: ["actions", "web"],
        }),
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

    const card = (await screen.findByRole("link", { name: githubLinkName })).closest("li");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".service-card-title .status-pill")?.textContent).toContain("正常");
    const componentRows = [...card!.querySelectorAll<HTMLElement>(".component-item")];
    expect(
      componentRows.map((row) => row.querySelector(".component-summary-name")?.textContent),
    ).toEqual(["Issues", "Actions", "Web", "Packages"]);

    const abnormalList = card!.querySelector(".component-listing > .component-item-list");
    const healthyList = card!.querySelector("#healthy-components-github");
    const issueRow = componentRows[0]!;
    const issueDetails = issueRow.querySelector("details");
    const actionsDetails = componentRows[1]?.querySelector("details");
    const packageRow = componentRows[3]!;
    expect(abnormalList?.querySelectorAll(".component-item")).toHaveLength(3);
    expect(healthyList).toHaveAttribute("hidden");
    expect(issueDetails).toBeNull();
    expect(actionsDetails?.open).toBe(true);
    expect(packageRow.querySelector("details")).toBeNull();
    expect(within(componentRows[1]!).getByText("関連情報 2件")).toBeInTheDocument();
    expect(within(packageRow).getByText("関連情報 1件")).toBeInTheDocument();
    const actionIncidents = componentRows[1]!.querySelectorAll(".incident-item");
    expect(actionIncidents).toHaveLength(2);
    const firstActionIncident = actionIncidents[0]!;
    expect(within(firstActionIncident).getByText("Actions delay")).toBeInTheDocument();
    expect(within(componentRows[1]!).getByText("Workflow queue delay")).toBeInTheDocument();
    expect(within(firstActionIncident).getByText("調査中")).toBeInTheDocument();
    expect(within(firstActionIncident).getByText("We are investigating.")).toBeInTheDocument();
    expect(
      within(firstActionIncident).getByRole("link", { name: "公式情報を見る" }),
    ).toHaveAttribute("href", "https://www.githubstatus.com/incidents/incident-1");
    expect(
      firstActionIncident.querySelector('time[datetime="2026-10-23T04:50:00.000Z"]'),
    ).not.toBeNull();
    expect(
      firstActionIncident.querySelector('time[datetime="2026-10-23T04:55:00.000Z"]'),
    ).not.toBeNull();
    expect(screen.getAllByText("Unmatched incident")).toHaveLength(1);
    expect(screen.getByText("コンポーネントに関連付けられていない情報")).toBeInTheDocument();
    expect(card!.querySelectorAll(".incident-item")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "正常なコンポーネント 1件を表示" }));
    expect(healthyList).not.toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "正常なコンポーネントを非表示" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(packageRow.querySelector("details")).toBeNull();
    expect(within(componentRows[3]!).getByText("Package notice")).toBeInTheDocument();
    expect(within(card!).getAllByText("Package notice")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "正常なコンポーネントを非表示" }));
    expect(healthyList).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "正常なコンポーネント 1件を表示" }));
    expect(within(card!).getAllByText("Package notice")).toHaveLength(1);
    expect(card!.querySelectorAll(".incident-item")).toHaveLength(4);

    const actionsSummary = actionsDetails?.querySelector("summary");
    expect(actionsSummary?.tagName).toBe("SUMMARY");
    fireEvent.click(actionsSummary!);
    expect(actionsDetails?.open).toBe(false);
    fireEvent.click(actionsSummary!);
    expect(actionsDetails?.open).toBe(true);
    expect(within(componentRows[1]!).getAllByText("Actions delay")).toHaveLength(1);
  });

  it("hides every healthy component initially and toggles the whole list", async () => {
    const github = service({
      components: [component("api", "API Requests"), component("git", "Git Operations")],
    });
    render(<App load={async () => payload([github])} />);

    const card = (await screen.findByRole("link", { name: githubLinkName })).closest("li");
    const healthyList = card!.querySelector("#healthy-components-github");
    expect(healthyList).toHaveAttribute("hidden");
    expect(
      within(card!).getByRole("button", { name: "正常なコンポーネント 2件を表示" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(healthyList?.querySelectorAll("details")).toHaveLength(0);
    expect(within(healthyList as HTMLElement).getByText("API Requests")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "正常なコンポーネント 2件を表示" }));
    expect(healthyList).not.toHaveAttribute("hidden");
    expect(screen.getByText("API Requests")).toBeInTheDocument();
    expect(screen.getByText("Git Operations")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "正常なコンポーネントを非表示" }));
    expect(healthyList).toHaveAttribute("hidden");
  });

  it("shows multiple abnormal components and leaves components without details non-interactive", async () => {
    const github = service({
      components: [
        component("api", "API Requests", "partial_outage"),
        component("actions", "Actions", "degraded_performance"),
        component("web", "Web", "unknown"),
        component("git", "Git Operations"),
      ],
    });
    render(<App load={async () => payload([github])} />);

    const card = (await screen.findByRole("link", { name: githubLinkName })).closest("li");
    const visibleList = card!.querySelector(".component-listing > .component-item-list");
    expect(visibleList?.querySelectorAll(".component-item")).toHaveLength(3);
    expect(within(visibleList as HTMLElement).getByText("API Requests")).toBeInTheDocument();
    expect(within(visibleList as HTMLElement).getByText("Actions")).toBeInTheDocument();
    expect(within(visibleList as HTMLElement).getByText("Web")).toBeInTheDocument();
    expect(within(visibleList as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    expect(visibleList?.querySelectorAll("details")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "正常なコンポーネント 1件を表示" }),
    ).toBeInTheDocument();
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

    const card = (await screen.findByRole("link", { name: githubLinkName })).closest("li");
    expect(card).not.toBeNull();
    expect(within(card!).getAllByText("全面障害")).toHaveLength(2);
    expect(card?.querySelector(".service-card-title .status-pill")?.textContent).toContain(
      "全面障害",
    );
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
    expect(screen.getByRole("link", { name: slackLinkName })).toBeInTheDocument();
  });

  it("filters services by name and clears the query", async () => {
    render(<App load={async () => basePayload} />);
    await screen.findByRole("link", { name: githubLinkName });
    fireEvent.change(screen.getByRole("searchbox", { name: "サービスを検索" }), {
      target: { value: "slack" },
    });
    expect(screen.getByRole("link", { name: slackLinkName })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: githubLinkName })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "検索をクリア" }));
    expect(screen.getByRole("link", { name: githubLinkName })).toBeInTheDocument();
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
