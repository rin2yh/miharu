import type { DashboardPayload } from "../../src/domain";

export type DashboardStatusFixture = {
  payload: DashboardPayload;
  incidentTitle: string;
  incidentUrl: string;
};

export function createDashboardStatusFixture(): DashboardStatusFixture {
  const checkedAt = new Date().toISOString();
  const incidentTitle = "GitHub Actions jobs are delayed";
  const incidentUrl = "https://www.githubstatus.com/incidents/actions-delay";

  return {
    payload: {
      generatedAt: checkedAt,
      freshnessWarningSeconds: 180,
      services: [
        {
          id: "slack",
          name: "Slack",
          statusPageUrl: "https://slack-status.com/",
          status: "operational",
          sourceStatus: "ok",
          summary: null,
          lastSuccessAt: checkedAt,
          hasFetchError: false,
          isStale: false,
          components: [],
          incidents: [],
        },
        {
          id: "github",
          name: "GitHub",
          statusPageUrl: "https://www.githubstatus.com/",
          status: "partial_outage",
          sourceStatus: "partial_outage",
          summary: "Actionsで一部のジョブ開始が遅延しています。",
          lastSuccessAt: checkedAt,
          hasFetchError: false,
          isStale: false,
          components: [
            {
              id: "actions",
              name: "Actions",
              status: "partial_outage",
              sourceStatus: "partial_outage",
              lastChangedAt: checkedAt,
            },
          ],
          incidents: [
            {
              id: "actions-delay",
              title: incidentTitle,
              body: "We are investigating delayed job starts for some GitHub Actions workflows.",
              kind: "incident",
              state: "investigating",
              sourceStatus: "investigating",
              sourceType: "incident",
              sourceImpact: "major",
              severityStatus: "partial_outage",
              componentIds: ["actions"],
              components: ["Actions"],
              officialCreatedAt: checkedAt,
              officialUpdatedAt: checkedAt,
              url: incidentUrl,
              lifecycle: "active",
              closureReason: null,
            },
          ],
        },
        {
          id: "notion",
          name: "Notion",
          statusPageUrl: "https://www.notion-status.com/",
          status: "operational",
          sourceStatus: "none",
          summary: null,
          lastSuccessAt: checkedAt,
          hasFetchError: false,
          isStale: false,
          components: [],
          incidents: [],
        },
      ],
      recentEvents: [
        {
          id: "actions-delay-updated",
          serviceId: "github",
          serviceName: "GitHub",
          incidentId: "actions-delay",
          title: incidentTitle,
          kind: "incident",
          eventKind: "updated",
          closureReason: null,
          sourceStatus: "investigating",
          severityStatus: "partial_outage",
          detectedAt: checkedAt,
          officialEventAt: checkedAt,
          url: incidentUrl,
        },
      ],
    },
    incidentTitle,
    incidentUrl,
  };
}
