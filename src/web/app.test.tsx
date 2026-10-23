import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
