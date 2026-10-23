import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type { DashboardPayload } from "../domain";
import { App } from "./App";

const firstPayload: DashboardPayload = {
  generatedAt: "2026-10-23T05:00:00.000Z",
  freshnessWarningSeconds: 180,
  services: [
    {
      id: "slack",
      name: "Slack",
      statusPageUrl: "https://slack-status.com/",
      status: "unknown",
      sourceStatus: "active",
      summary: null,
      lastSuccessAt: "2026-10-23T05:00:00.000Z",
      hasFetchError: false,
      isStale: false,
      incidents: [
        {
          id: "incident-1",
          title: "Messaging delays for some users",
          body: "We are investigating.",
          kind: "incident",
          state: "investigating",
          sourceStatus: "investigating",
          sourceType: "incident",
          sourceImpact: null,
          severityStatus: "partial_outage",
          components: ["Messaging"],
          officialCreatedAt: "2026-10-23T04:50:00.000Z",
          officialUpdatedAt: "2026-10-23T04:55:00.000Z",
          url: "https://slack-status.com/2026-10/incident-1",
        },
      ],
    },
    {
      id: "github",
      name: "GitHub",
      statusPageUrl: "https://www.githubstatus.com/",
      status: "operational",
      sourceStatus: "none",
      summary: null,
      lastSuccessAt: "2026-10-23T05:00:00.000Z",
      hasFetchError: false,
      isStale: false,
      incidents: [],
    },
  ],
  recentEvents: [],
};

describe("dashboard", () => {
  it("shows the service state, active incident, source link, and affected component", async () => {
    render(<App load={async () => firstPayload} />);

    expect(await screen.findByText("Messaging delays for some users")).toBeInTheDocument();
    expect(screen.getByText("障害の重要度: 部分障害")).toBeInTheDocument();
    expect(screen.getByText("Messaging")).toBeInTheDocument();
    const slackCard = screen.getByRole("heading", { name: "Slack" }).closest("article");
    expect(slackCard).not.toBeNull();
    expect(within(slackCard!).getByText("状態不明")).toBeInTheDocument();
    expect(within(slackCard!).getByRole("link", { name: /公式ステータスページ/ })).toHaveAttribute(
      "href",
      "https://slack-status.com/",
    );
    expect(within(slackCard!).getByText("最終取得成功")).toBeInTheDocument();
  });

  it("keeps the official aggregate status separate from incident severity", async () => {
    const officialOperationalPayload: DashboardPayload = {
      ...firstPayload,
      services: firstPayload.services.map((service) =>
        service.id === "slack"
          ? {
              ...service,
              status: "operational",
              incidents: service.incidents.map((incident) => ({
                ...incident,
                severityStatus: "degraded_performance",
              })),
            }
          : service,
      ),
    };
    const { container } = render(<App load={async () => officialOperationalPayload} />);

    const incidentTitle = await screen.findByText("Messaging delays for some users");
    const slackCard = incidentTitle.closest("article");
    expect(slackCard).not.toBeNull();
    expect(within(slackCard!).getByText("正常")).toBeInTheDocument();
    expect(within(slackCard!).getByText("障害の重要度: 性能低下")).toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll(".service-row h3"), (heading) => heading.textContent),
    ).toEqual(["Slack", "GitHub"]);
  });

  it("keeps healthy rows compact and separates affected services from incidents", async () => {
    const multiIncidentPayload: DashboardPayload = {
      ...firstPayload,
      services: firstPayload.services.map((service) =>
        service.id === "slack"
          ? {
              ...service,
              incidents: [
                ...service.incidents,
                { ...service.incidents[0], id: "incident-2", title: "File uploads delayed" },
              ],
            }
          : service,
      ),
    };
    render(<App load={async () => multiIncidentPayload} />);

    const incidentCount = await screen.findByText("インシデント");
    expect(incidentCount.parentElement).toHaveTextContent("2");
    expect(screen.getByText("影響サービス").parentElement).toHaveTextContent("1");
    const githubCard = screen.getByRole("heading", { name: "GitHub" }).closest("article");
    expect(githubCard).not.toBeNull();
    expect(
      within(githubCard!).getByRole("link", { name: "GitHubの公式ステータスページを開く" }),
    ).toHaveAttribute("href", "https://www.githubstatus.com/");
    expect(within(githubCard!).queryByText("最終取得成功")).not.toBeInTheDocument();
    expect(within(githubCard!).queryByText(/公開中の障害情報はありません/)).not.toBeInTheDocument();
  });

  it("filters services and can clear the search", async () => {
    render(<App load={async () => firstPayload} />);
    await screen.findByRole("heading", { name: "GitHub" });

    fireEvent.change(screen.getByRole("searchbox", { name: "サービスを検索" }), {
      target: { value: "Messaging delays" },
    });
    expect(screen.queryByRole("heading", { name: "Slack" })).not.toBeInTheDocument();
    expect(screen.getByText(/に一致するサービスはありません/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "サービスを検索" }), {
      target: { value: "slack" },
    });
    expect(screen.getByRole("heading", { name: "Slack" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "GitHub" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "検索をクリア" }));
    expect(screen.getByRole("heading", { name: "GitHub" })).toBeInTheDocument();
  });

  it("keeps the previous data and lets the user update manually", async () => {
    const nextPayload: DashboardPayload = {
      ...firstPayload,
      generatedAt: "2026-10-23T05:01:00.000Z",
      services: firstPayload.services.map((service) => ({
        ...service,
        incidents: service.incidents.map((incident) => ({
          ...incident,
          title: "Messaging is recovering",
        })),
      })),
    };
    const load = vi
      .fn<() => Promise<DashboardPayload>>()
      .mockResolvedValueOnce(firstPayload)
      .mockResolvedValueOnce(nextPayload);
    render(<App load={load} />);
    expect(await screen.findByText("Messaging delays for some users")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "手動更新" }));
    await waitFor(() => expect(screen.getByText("Messaging is recovering")).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads on entry and polls once per minute", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn<() => Promise<DashboardPayload>>(async () => firstPayload);
      render(<App load={load} />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(load).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_INTERVAL_MS);
      });
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes stale information visible", async () => {
    const stalePayload: DashboardPayload = {
      ...firstPayload,
      services: firstPayload.services.map((service) => ({
        ...service,
        isStale: true,
        incidents: [],
      })),
    };
    render(<App load={async () => stalePayload} />);
    expect(await screen.findAllByText(/情報が古い可能性があります/)).toHaveLength(2);
  });
});
