import type { NormalizedStatus } from "../../../domain";

export const statusColors: Record<NormalizedStatus, string> = {
  operational: "bg-healthy-bg text-healthy",
  degraded_performance: "bg-degraded-bg text-degraded",
  partial_outage: "bg-partial-bg text-partial",
  major_outage: "bg-outage-bg text-outage",
  under_maintenance: "bg-maintenance-bg text-maintenance",
  unknown: "bg-unknown-bg text-unknown",
};
