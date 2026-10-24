import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS } from "../../../domain";
import { incident } from "../../test-fixtures";
import { IncidentList } from "./incident-list";

describe("IncidentList", () => {
  it("labels an unverified incident without presenting it as recovered", () => {
    render(
      <IncidentList
        incidents={[incident({ title: "History entry missing", lifecycle: "unverified" })]}
      />,
    );

    const incidentItem = screen.getByRole("listitem", { name: "History entry missing" });
    expect(within(incidentItem).getByText("復旧未確認")).toBeVisible();
    expect(within(incidentItem).queryByText("復旧", { exact: true })).not.toBeInTheDocument();
  });

  it("reveals official incident details when its summary is opened", () => {
    render(<IncidentList incidents={[incident()]} />);

    const incidentItem = screen.getByRole("listitem", {
      name: "Messaging delays for some users",
    });
    const incidentBody = within(incidentItem).getByText("We are investigating.");
    expect(incidentBody).not.toBeVisible();
    expect(within(incidentItem).getByText("障害・調査中")).toBeVisible();

    fireEvent.click(within(incidentItem).getByText("Messaging delays for some users"));

    expect(incidentBody).toBeVisible();
    expect(within(incidentItem).getByText("障害の重要度: 部分障害")).toBeVisible();
    expect(within(incidentItem).getByRole("link", { name: "公式情報を見る" })).toHaveAttribute(
      "href",
      "https://www.githubstatus.com/incidents/incident-1",
    );
    expect(
      within(incidentItem)
        .getAllByRole("time")
        .map((time) => time.getAttribute("datetime")),
    ).toEqual(["2026-10-23T04:55:00.000Z", "2026-10-23T04:50:00.000Z"]);
  });

  it("shows an unverified incident with a recovery warning", () => {
    const unknownIncident = incident({
      id: "unknown-google-workspace-incident",
      title: "Earlier Gmail issue",
      body: null,
      state: "unknown",
      sourceStatus: INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
      lifecycle: "unverified",
      severityStatus: null,
      componentIds: ["gmail"],
      components: ["Gmail"],
      url: "https://www.google.com/appsstatus/dashboard/incidents/unknown-google-workspace-incident",
    });
    render(<IncidentList incidents={[unknownIncident]} />);

    const incidentItem = screen.getByRole("listitem", { name: unknownIncident.title });
    expect(within(incidentItem).getByText("復旧未確認")).toBeVisible();
    fireEvent.click(within(incidentItem).getByText(unknownIncident.title));

    expect(within(incidentItem).getByText("復旧状況を確認できていません。")).toBeVisible();
  });

  it("labels unverified maintenance as not yet confirmed ended", () => {
    const unverifiedMaintenance = incident({
      title: "Earlier maintenance status unavailable",
      kind: "maintenance",
      state: "unknown",
      sourceStatus: INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
      lifecycle: "unverified",
      severityStatus: null,
    });
    render(<IncidentList incidents={[unverifiedMaintenance]} />);

    const incidentItem = screen.getByRole("listitem", { name: unverifiedMaintenance.title });
    expect(within(incidentItem).getByText("終了未確認")).toBeVisible();
    fireEvent.click(within(incidentItem).getByText(unverifiedMaintenance.title));
    expect(within(incidentItem).getByText("メンテナンス")).toBeVisible();
  });

  it("expands one incident without opening its sibling", () => {
    const incidents = [
      incident({
        id: "actions-1",
        title: "Actions delay",
        body: "Actions are delayed.",
        componentIds: ["actions"],
      }),
      incident({
        id: "actions-2",
        title: "Workflow queue delay",
        body: "The workflow queue is delayed.",
        componentIds: ["actions"],
      }),
    ];
    render(<IncidentList incidents={incidents} nested />);

    const selectedIncident = screen.getByRole("listitem", { name: "Actions delay" });
    const siblingIncident = screen.getByRole("listitem", { name: "Workflow queue delay" });
    fireEvent.click(within(selectedIncident).getByText("Actions delay"));

    expect(within(selectedIncident).getByText("Actions are delayed.")).toBeVisible();
    expect(within(siblingIncident).getByText("The workflow queue is delayed.")).not.toBeVisible();
  });

  it("shows scheduled maintenance kind and state before opening its details", () => {
    const scheduledMaintenance = incident({
      title: "Cloudflare has scheduled maintenance for our storage systems",
      kind: "maintenance",
      state: "scheduled",
      sourceStatus: "scheduled",
      sourceType: "maintenance",
      sourceImpact: "maintenance",
      severityStatus: "under_maintenance",
    });
    render(<IncidentList incidents={[scheduledMaintenance]} />);

    const incidentItem = screen.getByRole("listitem", { name: scheduledMaintenance.title });
    const summary = within(incidentItem).getByText("メンテナンス予定");
    expect(summary).toBeVisible();
    expect(summary).toHaveClass("bg-maintenance-bg", "text-maintenance");

    fireEvent.click(within(incidentItem).getByText(scheduledMaintenance.title));

    expect(within(incidentItem).getByText("メンテナンス")).toBeVisible();
    expect(within(incidentItem).getByText("メンテナンス状態: メンテナンス")).toBeVisible();
  });

  it.each([
    {
      sourceStatus: "in_progress",
      state: "scheduled" as const,
      lifecycle: "active" as const,
      label: "メンテナンス中",
    },
    {
      sourceStatus: "completed",
      state: "resolved" as const,
      lifecycle: "resolved" as const,
      label: "メンテナンス完了",
    },
  ])("shows $sourceStatus maintenance state before opening its details", (status) => {
    const maintenance = incident({
      title: `${status.sourceStatus} maintenance`,
      kind: "maintenance",
      state: status.state,
      lifecycle: status.lifecycle,
      sourceStatus: status.sourceStatus,
      sourceType: "maintenance",
      sourceImpact: "maintenance",
      severityStatus: "under_maintenance",
    });
    render(<IncidentList incidents={[maintenance]} />);

    const incidentItem = screen.getByRole("listitem", { name: maintenance.title });
    expect(within(incidentItem).getByText(status.label)).toBeVisible();
  });

  it("labels a resolved incident as recovered while retaining its incident kind", () => {
    const resolvedIncident = incident({
      title: "Messaging delays have been resolved",
      kind: "incident",
      state: "resolved",
      sourceStatus: "resolved",
      lifecycle: "resolved",
    });
    render(<IncidentList incidents={[resolvedIncident]} />);

    const incidentItem = screen.getByRole("listitem", { name: resolvedIncident.title });
    expect(within(incidentItem).getByText("復旧済み")).toBeVisible();

    fireEvent.click(within(incidentItem).getByText(resolvedIncident.title));

    expect(within(incidentItem).getByText("障害情報")).toBeVisible();
  });
});
