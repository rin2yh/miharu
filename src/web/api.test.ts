import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDashboard } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("dashboard API client", () => {
  it("requests the read-only status endpoint without browser cache", async () => {
    const payload = {
      generatedAt: "now",
      services: [],
      recentEvents: [],
      freshnessWarningSeconds: 180,
    };
    const fetchMock = vi.fn<() => Promise<Response>>(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDashboard()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/status", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  });

  it("passes selected service IDs to the status endpoint", async () => {
    const fetchMock = vi.fn<() => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            generatedAt: "now",
            services: [],
            recentEvents: [],
            freshnessWarningSeconds: 180,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchDashboard(["slack", "github"]);

    expect(fetchMock).toHaveBeenCalledWith("/api/status?services=slack%2Cgithub", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  });

  it("reports a failed API response to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<() => Promise<Response>>(async () => new Response("{}", { status: 503 })),
    );
    await expect(fetchDashboard()).rejects.toThrow("Status API returned 503");
  });
});
