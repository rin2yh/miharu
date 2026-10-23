import type { DashboardPayload } from "../domain";

export async function fetchDashboard(): Promise<DashboardPayload> {
  const response = await fetch("/api/status", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Status API returned ${response.status}`);
  return (await response.json()) as DashboardPayload;
}
