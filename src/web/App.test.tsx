import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type { DashboardEvent, DashboardPayload, DashboardService } from "../domain";
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

function payload(
  services: DashboardService[],
  recentEvents: DashboardEvent[] = [],
): DashboardPayload {
  return {
    generatedAt: lastSuccessAt,
    freshnessWarningSeconds: 180,
    services,
    recentEvents,
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

    expect(screen.getByRole("link", { name: "miharu ホーム" })).toBeInTheDocument();
    expect(screen.queryByText(/公式情報を1分ごとに確認|画面更新 1分/)).not.toBeInTheDocument();
    expect(await screen.findByText("Messaging delays for some users")).toBeInTheDocument();
    const slackLink = screen.getByRole("link", { name: slackLinkName });
    expect(slackLink).toHaveAttribute("href", "https://slack-status.com/");
    expect(slackLink).toHaveAttribute("target", "_blank");
    const slackCard = screen.getByRole("listitem", { name: "Slackのサービス状況" });
    expect(within(slackCard!).getAllByRole("link", { name: /公式ステータスページ/ })).toHaveLength(
      1,
    );
    expect(within(slackCard!).queryByRole("link", { name: "公式" })).not.toBeInTheDocument();
    expect(within(slackCard!).getByLabelText("公式全体ステータス: 正常")).toBeInTheDocument();
    expect(
      within(slackCard!).queryByText("独立したコンポーネント状態は公式APIから提供されていません。"),
    ).not.toBeInTheDocument();
    expect(
      within(slackCard!).queryByRole("button", { name: /正常なコンポーネント/ }),
    ).not.toBeInTheDocument();
    const slackIncident = within(slackCard!).getByRole("listitem", {
      name: "Messaging delays for some users",
    });
    const slackIncidentTitle = within(slackIncident).getByText("Messaging delays for some users");
    expect(within(slackIncident).getByText("調査中")).toBeInTheDocument();
    expect(
      within(slackIncident)
        .getAllByRole("time")
        .find((time) => time.getAttribute("datetime") === "2026-10-23T04:55:00.000Z"),
    ).toBeInTheDocument();
    expect(within(slackIncident).getByText("We are investigating.")).not.toBeVisible();
    fireEvent.click(slackIncidentTitle);
    expect(within(slackIncident).getByText("障害の重要度: 部分障害")).toBeInTheDocument();
    expect(within(slackIncident).getByText("We are investigating.")).toBeInTheDocument();
    expect(
      within(slackIncident)
        .getAllByRole("time")
        .map((time) => time.getAttribute("datetime")),
    ).toContain("2026-10-23T04:50:00.000Z");
  });

  it("keeps incidents visible under one component and expands their details independently", async () => {
    const github = service({
      status: "operational",
      components: [
        component("web", "Web", "degraded_performance"),
        component("packages", "Packages"),
        component("actions", "Actions", "degraded_performance"),
        component("issues", "Issues", "major_outage"),
        component("api", "API Requests"),
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

    await screen.findByRole("link", { name: githubLinkName });
    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    expect(within(card!).getByLabelText("公式全体ステータス: 正常")).toBeInTheDocument();
    const visibleList = within(card!).getByRole("list", { name: "表示中のコンポーネント" });
    const healthyToggle = within(card!).getByRole("button", {
      name: "正常なコンポーネント 1件を表示",
    });
    const healthyList = document.getElementById(healthyToggle.getAttribute("aria-controls")!)!;
    const componentHeadings = within(visibleList).getAllByRole("heading", { level: 4 });
    expect(componentHeadings.map((heading) => heading.textContent)).toEqual([
      "Issues",
      "Actions",
      "Web",
      "Packages",
    ]);
    expect(componentHeadings).toHaveLength(4);
    expect(healthyList).toHaveAttribute("hidden");
    const actionsRow = within(visibleList).getByRole("listitem", {
      name: "Actionsコンポーネント",
    });
    expect(within(actionsRow).queryByRole("button", { name: "Actions", exact: true })).toBeNull();
    expect(within(actionsRow).getAllByText("詳細", { exact: true })).toHaveLength(2);
    const firstActionIncident = within(actionsRow).getByRole("listitem", { name: "Actions delay" });
    const firstActionTitle = within(firstActionIncident).getByText("Actions delay");
    expect(within(actionsRow).getByText("Workflow queue delay")).toBeVisible();
    expect(within(firstActionIncident).getByText("調査中")).toBeInTheDocument();
    expect(within(firstActionIncident).getByText("We are investigating.")).not.toBeVisible();
    fireEvent.click(firstActionTitle);
    expect(within(firstActionIncident).getByText("We are investigating.")).toBeInTheDocument();
    expect(
      within(firstActionIncident).getByRole("link", { name: "公式情報を見る" }),
    ).toHaveAttribute("href", "https://www.githubstatus.com/incidents/incident-1");
    expect(within(firstActionIncident).getByText(/公式発生/)).toBeInTheDocument();
    const actionTimes = within(firstActionIncident)
      .getAllByRole("time")
      .map((time) => time.getAttribute("datetime"));
    expect(actionTimes).toContain("2026-10-23T04:50:00.000Z");
    expect(actionTimes).toContain("2026-10-23T04:55:00.000Z");
    const directIncidentRegion = within(card!).getByRole("region", {
      name: "GitHubの障害・メンテナンス情報",
    });
    expect(
      within(directIncidentRegion).getByRole("listitem", { name: "Unmatched incident" }),
    ).toBeVisible();
    expect(
      within(card!).getByRole("heading", { name: "その他の障害・メンテナンス情報" }),
    ).toBeVisible();
    expect(within(card!).getAllByText("詳細", { exact: true })).toHaveLength(4);

    fireEvent.click(healthyToggle);
    expect(healthyList).not.toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "正常なコンポーネントを非表示" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const packageRow = within(visibleList).getByRole("listitem", {
      name: "Packagesコンポーネント",
    });
    expect(within(packageRow).getByText("Package notice")).toBeInTheDocument();
    expect(within(card!).getAllByText("Package notice", { exact: true })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "正常なコンポーネントを非表示" }));
    expect(healthyList).toHaveAttribute("hidden");
    fireEvent.click(healthyToggle);
    expect(within(card!).getAllByText("Package notice")).toHaveLength(1);
    expect(within(card!).getAllByText("詳細", { exact: true })).toHaveLength(4);
    fireEvent.click(firstActionTitle);
    expect(within(firstActionIncident).getByText("We are investigating.")).not.toBeVisible();
    fireEvent.click(firstActionTitle);
    expect(within(firstActionIncident).getByText("We are investigating.")).toBeVisible();
    expect(within(actionsRow).getAllByText("Actions delay", { exact: true })).toHaveLength(1);
  });

  it("hides every healthy component initially and toggles the whole list", async () => {
    const github = service({
      components: [component("api", "API Requests"), component("git", "Git Operations")],
    });
    render(<App load={async () => payload([github])} />);

    await screen.findByRole("link", { name: githubLinkName });
    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    const healthyToggle = within(card!).getByRole("button", {
      name: "正常なコンポーネント 2件を表示",
    });
    const healthyList = document.getElementById(healthyToggle.getAttribute("aria-controls")!)!;
    expect(healthyList).toHaveAttribute("hidden");
    expect(
      within(card!).getByRole("button", { name: "正常なコンポーネント 2件を表示" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(healthyList).queryByRole("button", { name: /詳細/, hidden: true }),
    ).not.toBeInTheDocument();
    expect(
      within(healthyList).getByRole("heading", { name: "API Requests", hidden: true }),
    ).toBeInTheDocument();

    fireEvent.click(healthyToggle);
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

    await screen.findByRole("link", { name: githubLinkName });
    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    const visibleList = within(card!).getByRole("list", { name: "表示中のコンポーネント" });
    const componentHeadings = within(visibleList).getAllByRole("heading", { level: 4 });
    expect(componentHeadings.map((heading) => heading.textContent)).toEqual([
      "API Requests",
      "Actions",
      "Web",
    ]);
    expect(within(visibleList).queryByRole("button")).not.toBeInTheDocument();
    expect(within(visibleList).queryByRole("heading", { level: 5 })).not.toBeInTheDocument();
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

    await screen.findByRole("link", { name: githubLinkName });
    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    expect(within(card!).getAllByText("全面障害")).toHaveLength(2);
    expect(within(card!).getByLabelText("公式全体ステータス: 全面障害")).toBeInTheDocument();
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
    expect(await screen.findByRole("alert")).toHaveTextContent("前回取得時のものです");
    expect(screen.getByText("Messaging delays for some users")).toBeInTheDocument();
  });

  it("uses official event times and concise labels in the recent updates", async () => {
    const event: DashboardEvent = {
      id: "event-1",
      serviceId: "github",
      serviceName: "GitHub",
      incidentId: "incident-1",
      title: "Actions delay",
      kind: "incident",
      eventKind: "opened",
      sourceStatus: "investigating",
      severityStatus: "partial_outage",
      detectedAt: lastSuccessAt,
      officialEventAt: "2026-10-23T04:50:00.000Z",
      url: "https://www.githubstatus.com/incidents/incident-1",
    };
    render(<App load={async () => payload([service()], [event])} />);

    expect(await screen.findByText("障害発生")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Actions delay" })).toHaveAttribute("href", event.url);
    expect(screen.getByText(/公式時刻/)).toBeInTheDocument();
    expect(screen.queryByText(/アプリ検知|検知/)).not.toBeInTheDocument();
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
    expect(await screen.findAllByText(/最新の状態と異なる可能性があります/)).toHaveLength(2);
  });
});
