import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type { DashboardEvent, DashboardPayload } from "../domain";
import { App } from "./app";
import {
  basePayload,
  githubLinkName,
  lastSuccessAt,
  payload,
  service,
  slackLinkName,
} from "./test-fixtures";

describe("dashboard", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
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

  it("retries after the initial load fails", async () => {
    const load = vi
      .fn<() => Promise<DashboardPayload>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(basePayload);
    render(<App load={load} />);

    expect(await screen.findByText("一覧を読み込めませんでした。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度取得する" }));

    expect(await screen.findByRole("link", { name: slackLinkName })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("renders the shared brand in the mobile header and desktop sidebar with a home link", () => {
    window.history.replaceState(null, "", "/?services=github");
    render(<App load={async () => basePayload} />);

    const brandLinks = screen.getAllByRole("link", { name: "miharu ホーム" });
    expect(brandLinks).toHaveLength(2);
    expect(brandLinks.map((link) => link.getAttribute("href"))).toEqual(["/", "/"]);

    const mobileHeader = brandLinks.find((link) => link.closest("header"));
    expect(mobileHeader?.parentElement).toHaveClass("lg:hidden");

    const desktopLink = brandLinks.find((link) => link.closest("aside"));
    expect(desktopLink?.closest("aside")).toHaveClass("hidden", "lg:flex");
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
    const slackEvent: DashboardEvent = {
      id: "slack-event",
      serviceId: "slack",
      serviceName: "Slack",
      incidentId: "slack-incident",
      title: "Slack update",
      kind: "incident",
      eventKind: "opened",
      sourceStatus: "investigating",
      severityStatus: "partial_outage",
      detectedAt: lastSuccessAt,
      officialEventAt: lastSuccessAt,
      url: "https://slack-status.com/incident/slack-incident",
    };
    const githubEvent: DashboardEvent = {
      ...slackEvent,
      id: "github-event",
      serviceId: "github",
      serviceName: "GitHub",
      title: "GitHub update",
      url: "https://www.githubstatus.com/incidents/github-incident",
    };
    render(<App load={async () => payload(basePayload.services, [slackEvent, githubEvent])} />);
    await screen.findByRole("link", { name: githubLinkName });
    fireEvent.change(screen.getByRole("searchbox", { name: "サービスを検索" }), {
      target: { value: "slack" },
    });
    expect(screen.getByRole("link", { name: slackLinkName })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: githubLinkName })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Slack update" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GitHub update" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "検索をクリア" }));
    expect(screen.getByRole("link", { name: githubLinkName })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub update" })).toBeInTheDocument();
  });

  it("shows an empty message when a service search has no matching recent events", async () => {
    const githubEvent: DashboardEvent = {
      id: "github-event",
      serviceId: "github",
      serviceName: "GitHub",
      incidentId: "github-incident",
      title: "GitHub update",
      kind: "incident",
      eventKind: "opened",
      sourceStatus: "investigating",
      severityStatus: "partial_outage",
      detectedAt: lastSuccessAt,
      officialEventAt: lastSuccessAt,
      url: "https://www.githubstatus.com/incidents/github-incident",
    };
    render(<App load={async () => payload(basePayload.services, [githubEvent])} />);
    await screen.findByRole("link", { name: githubLinkName });

    fireEvent.change(screen.getByRole("searchbox", { name: "サービスを検索" }), {
      target: { value: "Slack" },
    });

    expect(screen.getByText("表示中のサービスに最近の更新はありません。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GitHub update" })).not.toBeInTheDocument();
  });

  it("filters services and recent updates from the URL before applying the name search", async () => {
    window.history.replaceState(null, "", "/?services=github,slack,github,unknown");
    const slackEvent: DashboardEvent = {
      id: "slack-event",
      serviceId: "slack",
      serviceName: "Slack",
      incidentId: "slack-incident",
      title: "Slack update",
      kind: "incident",
      eventKind: "opened",
      sourceStatus: "investigating",
      severityStatus: "partial_outage",
      detectedAt: lastSuccessAt,
      officialEventAt: lastSuccessAt,
      url: "https://slack-status.com/incident/slack-incident",
    };
    const githubEvent: DashboardEvent = {
      ...slackEvent,
      id: "github-event",
      serviceId: "github",
      serviceName: "GitHub",
      title: "GitHub update",
      url: "https://www.githubstatus.com/incidents/github-incident",
    };
    render(<App load={async () => payload(basePayload.services, [slackEvent, githubEvent])} />);

    const serviceList = await screen.findByRole("list", { name: "サービス一覧" });
    const serviceLinks = within(serviceList)
      .getAllByRole("link")
      .filter((link) =>
        [slackLinkName, githubLinkName].includes(link.getAttribute("aria-label") ?? ""),
      );
    expect(serviceLinks.map((link) => link.getAttribute("aria-label"))).toEqual([
      slackLinkName,
      githubLinkName,
    ]);
    expect(screen.getByRole("link", { name: "Slack update" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub update" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "サービスを検索" }), {
      target: { value: "github" },
    });

    expect(screen.getByRole("link", { name: githubLinkName })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: slackLinkName })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub update" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Slack update" })).not.toBeInTheDocument();
  });

  it("keeps selection changes as a draft until apply", async () => {
    window.history.replaceState(null, "", "/?services=github");
    render(<App load={async () => basePayload} />);
    await screen.findByRole("link", { name: githubLinkName });
    expect(screen.queryByRole("link", { name: slackLinkName })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("表示サービスを選択"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Slack" }));

    expect(screen.getByText("未適用")).toBeInTheDocument();
    expect(window.location.search).toBe("?services=github");
    expect(screen.queryByRole("link", { name: slackLinkName })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "この条件で表示" }));

    expect(new URL(window.location.href).searchParams.get("services")).toBe("slack,github");
    expect(await screen.findByRole("link", { name: slackLinkName })).toBeInTheDocument();
    expect(screen.queryByText("未適用")).not.toBeInTheDocument();
  });

  it("shows an empty state for unknown URL services and disables applying no selection", async () => {
    window.history.replaceState(null, "", "/?services=missing,unknown");
    render(<App load={async () => basePayload} />);

    expect(await screen.findByText("条件に一致するサービスはありません。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: githubLinkName })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この条件で表示" })).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: /Messaging delays for some users/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("表示サービスを選択"));
    fireEvent.click(screen.getByRole("checkbox", { name: "すべて選択" }));
    expect(screen.getByRole("button", { name: "この条件で表示" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: githubLinkName })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "この条件で表示" }));
    expect(new URL(window.location.href).searchParams.has("services")).toBe(false);
    expect(await screen.findByRole("link", { name: githubLinkName })).toBeInTheDocument();
  });

  it("updates applied services when browser history changes the URL", async () => {
    window.history.replaceState(null, "", "/?services=github");
    render(<App load={async () => basePayload} />);
    await screen.findByRole("link", { name: githubLinkName });

    window.history.pushState(null, "", "/");
    fireEvent.popState(window);

    expect(await screen.findByRole("link", { name: slackLinkName })).toBeInTheDocument();
  });

  it("shows an empty data message when the selected service is missing from the response", async () => {
    window.history.replaceState(null, "", "/?services=github");
    render(<App load={async () => payload([service({ id: "slack", name: "Slack" })])} />);

    expect(await screen.findByText("条件に一致するサービスはありません。")).toBeInTheDocument();
    expect(screen.queryByText("「」に一致するサービスはありません。")).not.toBeInTheDocument();
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

  it("does not duplicate a manual refresh when a polling interval overlaps", async () => {
    vi.useFakeTimers();
    try {
      let finishManualRequest: ((result: DashboardPayload) => void) | undefined;
      const load = vi
        .fn<() => Promise<DashboardPayload>>()
        .mockResolvedValueOnce(basePayload)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishManualRequest = resolve;
            }),
        );
      render(<App load={load} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole("button", { name: "手動更新" }));
      expect(load).toHaveBeenCalledTimes(2);
      await act(async () => await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_INTERVAL_MS));
      expect(load).toHaveBeenCalledTimes(2);

      await act(async () => {
        finishManualRequest?.(payload([service({ name: "Updated GitHub" })]));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("Updated GitHub")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not update after an in-flight request finishes following unmount", async () => {
    vi.useFakeTimers();
    try {
      let finishRequest: ((result: DashboardPayload) => void) | undefined;
      const load = vi.fn<() => Promise<DashboardPayload>>(
        () =>
          new Promise((resolve) => {
            finishRequest = resolve;
          }),
      );
      const { unmount } = render(<App load={load} />);
      expect(load).toHaveBeenCalledTimes(1);
      unmount();

      await act(async () => {
        finishRequest?.(basePayload);
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_INTERVAL_MS));
      expect(load).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("link", { name: slackLinkName })).not.toBeInTheDocument();
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
