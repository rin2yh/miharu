import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_POLL_INTERVAL_MS } from "../shared/config/services";
import type { DashboardPayload } from "../domain";
import { App } from "./app";
import { basePayload, githubLinkName, payload, service, slackLinkName } from "./test-fixtures";

afterEach(() => vi.useRealTimers());

describe("App", () => {
  it("links the product name home without repeating the polling schedule", () => {
    render(<App load={async () => basePayload} />);

    expect(screen.getByRole("link", { name: "miharu ホーム" })).toBeInTheDocument();
    expect(screen.queryByText(/公式情報を1分ごとに確認|画面更新 1分/)).not.toBeInTheDocument();
  });

  it("shows an initial load failure and retries successfully", async () => {
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

  it("keeps the previous snapshot visible when a manual refresh fails", async () => {
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

  it("shows new incidents and removes them after recovery on refresh", async () => {
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

  it("filters services by name and clears the search", async () => {
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

  it("shows an empty state when the search matches no services", async () => {
    render(<App load={async () => basePayload} />);
    await screen.findByRole("link", { name: githubLinkName });

    fireEvent.change(screen.getByRole("searchbox", { name: "サービスを検索" }), {
      target: { value: "unlisted service" },
    });

    expect(
      screen.getByText("「unlisted service」に一致するサービスはありません。"),
    ).toBeInTheDocument();
    expect(screen.getByText("0サービス")).toBeInTheDocument();
  });

  it("loads on entry and polls once per minute", async () => {
    vi.useFakeTimers();
    const load = vi.fn<() => Promise<DashboardPayload>>(async () => basePayload);
    render(<App load={load} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_INTERVAL_MS));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not start a duplicate request when polling and manual refresh overlap", async () => {
    vi.useFakeTimers();
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
  });

  it("does not update the page after an in-flight load finishes following unmount", async () => {
    vi.useFakeTimers();
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
    expect(screen.queryByRole("link", { name: slackLinkName })).not.toBeInTheDocument();
  });

  it("makes stale information visible", async () => {
    const stalePayload = payload(basePayload.services.map((item) => ({ ...item, isStale: true })));
    render(<App load={async () => stalePayload} />);
    expect(await screen.findAllByText(/最新の状態と異なる可能性があります/)).toHaveLength(2);
  });
});
