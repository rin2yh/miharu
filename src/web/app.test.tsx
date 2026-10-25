import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_POLL_INTERVAL_MS, SERVICES } from "../shared/config/services";
import type { DashboardEvent, DashboardPayload } from "../domain";
import { App } from "./app";
import {
  basePayload,
  githubLinkName,
  incident,
  lastSuccessAt,
  payload,
  service,
  slackLinkName,
} from "./test-fixtures";

type DashboardLoader = (
  serviceIds: readonly string[],
  signal?: AbortSignal,
) => Promise<DashboardPayload>;
type DeferredDashboardRequest = {
  serviceIds: readonly string[];
  signal?: AbortSignal;
  resolve: (result: DashboardPayload) => void;
};

function renderDashboard(load: DashboardLoader) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
        refetchOnReconnect: false,
        refetchOnWindowFocus: true,
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <App load={load} />
    </QueryClientProvider>,
  );
}

function createDeferredDashboardLoader() {
  const requests: DeferredDashboardRequest[] = [];
  const load = vi.fn<DashboardLoader>(
    (serviceIds, signal) =>
      new Promise((resolve) => {
        requests.push({ serviceIds: [...serviceIds], signal, resolve });
      }),
  );
  return { load, requests };
}

function getSidebarOrder() {
  return within(screen.getByRole("complementary", { name: "サービス選択" }))
    .getAllByRole("button")
    .map((button) => button.lastElementChild?.textContent?.trim() ?? "")
    .filter((name) => name !== "すべて");
}

function getMainOrder() {
  return Array.from(
    screen.getByRole("list", { name: "サービス一覧" }).querySelectorAll(":scope > li[aria-label]"),
  ).map((item) => item.getAttribute("aria-label")?.replace(/のサービス状況$/, ""));
}

describe("dashboard", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("shows errors without replacing the last loaded snapshot", async () => {
    const load = vi
      .fn<() => Promise<DashboardPayload>>()
      .mockResolvedValueOnce(basePayload)
      .mockRejectedValueOnce(new Error("unavailable"));
    renderDashboard(load);
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
    renderDashboard(load);

    expect(await screen.findByText("一覧を読み込めませんでした。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度取得する" }));

    expect(await screen.findByRole("link", { name: slackLinkName })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("renders the shared brand in the mobile header and desktop sidebar with a home link", () => {
    window.history.replaceState(null, "", "/?services=github");
    renderDashboard(async () => basePayload);

    const brandLinks = screen.getAllByRole("link", { name: "miharu ホーム" });
    expect(brandLinks).toHaveLength(2);
    expect(brandLinks.map((link) => link.getAttribute("href"))).toEqual(["/", "/"]);

    const mobileHeader = brandLinks.find((link) => link.closest("header"));
    expect(mobileHeader?.parentElement).toHaveClass("lg:hidden");

    const desktopLink = brandLinks.find((link) => link.closest("aside"));
    expect(desktopLink?.closest("aside")).toHaveClass("hidden", "lg:block");
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
      closureReason: null,
      sourceStatus: "investigating",
      severityStatus: "partial_outage",
      detectedAt: lastSuccessAt,
      officialEventAt: "2026-10-23T04:50:00.000Z",
      url: "https://www.githubstatus.com/incidents/incident-1",
    };
    renderDashboard(async () => payload([service()], [event]));

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
    renderDashboard(load);
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
      closureReason: null,
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
    renderDashboard(async () => payload(basePayload.services, [slackEvent, githubEvent]));
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

  it("shares the main service order with the sidebar while loading and after updates", async () => {
    let resolveInitialLoad: ((result: DashboardPayload) => void) | undefined;
    const initialPayload = payload([
      service({ id: "github", name: "GitHub", status: "degraded_performance" }),
      service({ id: "slack", name: "Slack", status: "operational" }),
      service({ id: "notion", name: "Notion", status: "partial_outage" }),
    ]);
    const updatedPayload = payload([
      service({ id: "notion", name: "Notion", status: "partial_outage" }),
      service({ id: "github", name: "GitHub", status: "major_outage" }),
      service({
        id: "slack",
        name: "Slack",
        status: "operational",
        incidents: [incident({ id: "slack-incident", title: "Slack issue" })],
      }),
    ]);
    const load = vi
      .fn<() => Promise<DashboardPayload>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitialLoad = resolve;
          }),
      )
      .mockResolvedValueOnce(updatedPayload);
    renderDashboard(load);

    expect(getSidebarOrder()).toEqual(SERVICES.map(({ name }) => name));

    await act(async () => {
      resolveInitialLoad?.(initialPayload);
    });
    await screen.findByRole("list", { name: "サービス一覧" });

    const missingServiceNames = SERVICES.filter(
      ({ id }) => !initialPayload.services.some((dashboardService) => dashboardService.id === id),
    ).map(({ name }) => name);
    const initialOrder = ["Notion", "GitHub", "Slack"];
    expect(getMainOrder()).toEqual(initialOrder);
    expect(getSidebarOrder()).toEqual([...initialOrder, ...missingServiceNames]);

    fireEvent.click(screen.getByRole("button", { name: "手動更新" }));
    await waitFor(() => expect(getMainOrder()).toEqual(["Slack", "GitHub", "Notion"]));
    expect(getSidebarOrder()).toEqual(["Slack", "GitHub", "Notion", ...missingServiceNames]);
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
      closureReason: null,
      sourceStatus: "investigating",
      severityStatus: "partial_outage",
      detectedAt: lastSuccessAt,
      officialEventAt: lastSuccessAt,
      url: "https://www.githubstatus.com/incidents/github-incident",
    };
    renderDashboard(async () => payload(basePayload.services, [githubEvent]));
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
      closureReason: null,
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
    renderDashboard(async () => payload(basePayload.services, [slackEvent, githubEvent]));

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
    const load = vi.fn<() => Promise<DashboardPayload>>(async () => basePayload);
    renderDashboard(load);
    await screen.findByRole("link", { name: githubLinkName });
    expect(load).toHaveBeenNthCalledWith(1, ["github"], expect.any(AbortSignal));
    expect(screen.queryByRole("link", { name: slackLinkName })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("表示サービスを選択"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Slack" }));

    expect(screen.getByText("未適用")).toBeInTheDocument();
    expect(window.location.search).toBe("?services=github");
    expect(screen.queryByRole("link", { name: slackLinkName })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "この条件で表示" }));

    expect(new URL(window.location.href).searchParams.get("services")).toBe("slack,github");
    expect(await screen.findByRole("link", { name: slackLinkName })).toBeInTheDocument();
    await waitFor(() =>
      expect(load).toHaveBeenNthCalledWith(2, ["slack", "github"], expect.any(AbortSignal)),
    );
    expect(screen.queryByText("未適用")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "手動更新" }));
    await waitFor(() =>
      expect(load).toHaveBeenNthCalledWith(3, ["slack", "github"], expect.any(AbortSignal)),
    );
  });

  it("shows an empty state for unknown URL services and disables applying no selection", async () => {
    window.history.replaceState(null, "", "/?services=missing,unknown");
    const load = vi.fn<DashboardLoader>(async () => basePayload);
    renderDashboard(load);

    expect(await screen.findByText("条件に一致するサービスはありません。")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
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
    const load = vi.fn<() => Promise<DashboardPayload>>(async () => basePayload);
    renderDashboard(load);
    await screen.findByRole("link", { name: githubLinkName });

    window.history.pushState(null, "", "/");
    fireEvent.popState(window);

    expect(await screen.findByRole("link", { name: slackLinkName })).toBeInTheDocument();
    await waitFor(() =>
      expect(load).toHaveBeenNthCalledWith(
        2,
        SERVICES.map(({ id }) => id),
        expect.any(AbortSignal),
      ),
    );
  });

  it("refetches when the selection changes from A to B and back to A", async () => {
    window.history.replaceState(null, "", "/?services=github");
    const { load, requests } = createDeferredDashboardLoader();
    renderDashboard(load);
    await waitFor(() => expect(requests).toHaveLength(1));

    window.history.pushState(null, "", "/?services=slack");
    fireEvent.popState(window);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]?.signal?.aborted).toBe(true);

    window.history.pushState(null, "", "/?services=github");
    fireEvent.popState(window);
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests.map(({ serviceIds }) => serviceIds)).toEqual([
      ["github"],
      ["slack"],
      ["github"],
    ]);
    expect(requests[1]?.signal?.aborted).toBe(true);

    await act(async () => {
      requests[0]?.resolve(payload([service({ name: "Stale GitHub" })]));
      requests[1]?.resolve(payload([service({ id: "slack", name: "Stale Slack" })]));
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale GitHub")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale Slack")).not.toBeInTheDocument();

    await act(async () => {
      requests[2]?.resolve(payload([service({ name: "Latest GitHub" })]));
    });
    expect(await screen.findByText("Latest GitHub")).toBeInTheDocument();
  });

  it("ignores a manual refresh result after the service selection changes", async () => {
    window.history.replaceState(null, "", "/?services=github");
    const { load, requests } = createDeferredDashboardLoader();
    renderDashboard(load);
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0]?.resolve(basePayload);
    });
    await screen.findByRole("link", { name: githubLinkName });

    fireEvent.click(screen.getByRole("button", { name: "手動更新" }));
    await waitFor(() => expect(requests).toHaveLength(2));

    window.history.pushState(null, "", "/?services=slack");
    fireEvent.popState(window);
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[1]?.signal?.aborted).toBe(true);

    await act(async () => {
      requests[2]?.resolve(payload([service({ id: "slack", name: "Current Slack" })]));
    });
    expect(await screen.findByText("Current Slack")).toBeInTheDocument();

    await act(async () => {
      requests[1]?.resolve(payload([service({ name: "Stale manual GitHub" })]));
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale manual GitHub")).not.toBeInTheDocument();
    expect(screen.getByText("Current Slack")).toBeInTheDocument();
  });

  it("shows an empty data message when the selected service is missing from the response", async () => {
    window.history.replaceState(null, "", "/?services=github");
    renderDashboard(async () => payload([service({ id: "slack", name: "Slack" })]));

    expect(await screen.findByText("条件に一致するサービスはありません。")).toBeInTheDocument();
    expect(screen.queryByText("「」に一致するサービスはありません。")).not.toBeInTheDocument();
  });

  it("loads on entry and polls once per minute", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn<() => Promise<DashboardPayload>>(async () => basePayload);
      renderDashboard(load);
      await act(async () => await Promise.resolve());
      expect(load).toHaveBeenCalledTimes(1);
      await act(async () => await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_INTERVAL_MS));
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses polling in a background tab and refreshes when the tab returns", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn<() => Promise<DashboardPayload>>(async () => basePayload);
      renderDashboard(load);
      await act(async () => await Promise.resolve());
      expect(load).toHaveBeenCalledTimes(1);

      const visibility = vi.spyOn(document, "visibilityState", "get");
      visibility.mockReturnValue("hidden");
      fireEvent(window, new Event("visibilitychange"));
      await act(async () => await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_INTERVAL_MS));
      expect(load).toHaveBeenCalledTimes(1);

      visibility.mockReturnValue("visible");
      await act(async () => {
        fireEvent(window, new Event("visibilitychange"));
        await Promise.resolve();
      });
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
      renderDashboard(load);
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
      const { unmount } = renderDashboard(load);
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
    renderDashboard(async () => stalePayload);
    expect(await screen.findAllByText(/最新の状態と異なる可能性があります/)).toHaveLength(2);
  });
});
