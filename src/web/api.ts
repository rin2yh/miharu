import type { DashboardPayload } from "../domain";

export async function fetchDashboard(serviceIds?: readonly string[]): Promise<DashboardPayload> {
  const query =
    serviceIds === undefined ? "" : `?services=${encodeURIComponent(serviceIds.join(","))}`;
  const response = await fetch(`/api/status${query}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Status API returned ${response.status}`);
  return (await response.json()) as DashboardPayload;
}
