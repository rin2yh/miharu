import type { IncidentDisplayCategory, NormalizedIncident } from "./index";

type ClassificationEvidence = Pick<NormalizedIncident, "kind" | "sourceType" | "sourceImpact">;

/** Listing format and progress are independent of the incident's actual impact. */
export function classifyIncident(
  incident: ClassificationEvidence,
  provider?: string,
): IncidentDisplayCategory {
  if (incident.kind === "maintenance") return "maintenance";
  const impact = incident.sourceImpact?.trim().toLowerCase();
  switch (impact) {
    case "none":
      return "notice";
    case "minor":
    case "major":
    case "critical":
      return "outage";
  }
  if (provider === "google-workspace") {
    switch (impact) {
      case "service_information":
        return "notice";
      case "service_disruption":
      case "service_outage":
        return "outage";
    }
  }
  // Slack's API defines issue types; generic Statuspage "incident" is just a format.
  if (provider === "slack") {
    switch (incident.sourceType?.trim().toLowerCase()) {
      case "incident":
        return "outage";
      case "notice":
        return "notice";
    }
  }
  return "unknown";
}
