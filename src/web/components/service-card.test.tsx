import { fireEvent, render, screen, within } from "@testing-library/react";
import { siClaude, siCloudflare, siGithub, siNotion } from "simple-icons";
import { describe, expect, it } from "vitest";
import { INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS } from "../../domain";
import { ServiceCard } from "./service-card";
import { component, githubLinkName, incident, service, slackLinkName } from "../test-fixtures";

describe("ServiceCard", () => {
  it.each([
    { id: "cloudflare", name: "Cloudflare", icon: siCloudflare, invertInDark: false },
    { id: "notion", name: "Notion", icon: siNotion, invertInDark: true },
    { id: "github", name: "GitHub", icon: siGithub, invertInDark: true },
    { id: "claude", name: "Claude", icon: siClaude, invertInDark: false },
  ])("shows the $name brand icon", ({ id, name, icon, invertInDark }) => {
    render(<ServiceCard service={service({ id, name })} />);

    const card = screen.getByRole("listitem", { name: `${name}のサービス状況` });
    const iconWrapper = card.querySelector("header > span");

    expect(iconWrapper?.querySelector("svg path")).toHaveAttribute("d", icon.path);
    expect(iconWrapper).toHaveStyle({ color: `#${icon.hex}` });
    expect(iconWrapper?.classList.contains("dark:[&>svg]:invert")).toBe(invertInDark);
  });

  it("uses a theme-colored SVG for ChatGPT", () => {
    render(<ServiceCard service={service({ id: "chatgpt", name: "ChatGPT" })} />);

    const card = screen.getByRole("listitem", { name: "ChatGPTのサービス状況" });
    const iconWrapper = card.querySelector("header > span");
    const iconPath = iconWrapper?.querySelector("svg path");

    expect(iconPath?.getAttribute("d")).toBeTruthy();
    expect(iconWrapper).toHaveClass("text-muted", "dark:text-ink");
    expect(iconWrapper).not.toHaveAttribute("style");
    expect(iconWrapper).not.toHaveClass("dark:[&>svg]:invert");
  });

  it("links directly to the official status page", () => {
    render(<ServiceCard service={service()} />);

    const statusPageLink = screen.getByRole("link", { name: githubLinkName });
    expect(statusPageLink).toHaveAttribute("href", "https://www.githubstatus.com/");
    expect(statusPageLink).toHaveAttribute("target", "_blank");
  });

  it("links Slack to its official status page", () => {
    render(
      <ServiceCard
        service={service({
          id: "slack",
          name: "Slack",
          statusPageUrl: "https://slack-status.com/",
        })}
      />,
    );

    expect(screen.getByRole("link", { name: slackLinkName })).toHaveAttribute(
      "href",
      "https://slack-status.com/",
    );
  });

  it("shows incidents when the service has no component catalogue", () => {
    render(<ServiceCard service={service({ incidents: [incident()] })} />);

    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    expect(
      within(card).getByRole("listitem", { name: "Messaging delays for some users" }),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole("list", { name: "表示中のコンポーネント" }),
    ).not.toBeInTheDocument();
  });

  it("reveals official incident details when its summary is opened", () => {
    render(<ServiceCard service={service({ incidents: [incident()] })} />);

    const incidentItem = screen.getByRole("listitem", {
      name: "Messaging delays for some users",
    });
    const incidentBody = within(incidentItem).getByText("We are investigating.");
    expect(incidentBody).not.toBeVisible();

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

  it("shows Google Workspace as unknown when history has no active incidents", () => {
    const summary =
      "公式の履歴に進行中の障害はありません。製品の現在の稼働状態は公開データから判断できません。";
    render(
      <ServiceCard
        service={service({
          id: "google-workspace",
          name: "Google Workspace",
          statusPageUrl: "https://www.google.com/appsstatus/dashboard/",
          status: "unknown",
          sourceStatus: "no_active_incidents",
          summary,
          components: [component("gmail", "Gmail", "unknown")],
        })}
      />,
    );

    const card = screen.getByRole("listitem", { name: "Google Workspaceのサービス状況" });
    expect(within(card).getByLabelText("公式全体ステータス: 状態不明")).toBeVisible();
    expect(within(card).getByText(summary)).toBeVisible();
  });

  it("shows an unverified Google Workspace incident with a recovery warning", () => {
    const unknownIncident = incident({
      id: "unknown-google-workspace-incident",
      title: "Earlier Gmail issue",
      body: null,
      state: "unknown",
      sourceStatus: INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
      severityStatus: null,
      componentIds: ["gmail"],
      components: ["Gmail"],
      url: "https://www.google.com/appsstatus/dashboard/incidents/unknown-google-workspace-incident",
    });
    const summary = "公式の履歴フィードから現在の状態を判断できません。";
    render(
      <ServiceCard
        service={service({
          id: "google-workspace",
          name: "Google Workspace",
          statusPageUrl: "https://www.google.com/appsstatus/dashboard/",
          status: "unknown",
          sourceStatus: INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
          summary,
          components: [component("gmail", "Gmail", "unknown")],
          incidents: [unknownIncident],
        })}
      />,
    );

    const card = screen.getByRole("listitem", { name: "Google Workspaceのサービス状況" });
    expect(within(card).getByLabelText("公式全体ステータス: 状態不明")).toBeVisible();
    expect(within(card).getByText(summary)).toBeVisible();
    const gmail = within(card).getByRole("listitem", { name: "Gmailコンポーネント" });
    expect(within(gmail).getAllByText("状態不明")).toHaveLength(2);
    const incidentItem = within(gmail).getByRole("listitem", { name: unknownIncident.title });
    expect(within(incidentItem).getByText("状態不明")).toBeVisible();
    fireEvent.click(within(incidentItem).getByText(unknownIncident.title));

    expect(within(incidentItem).getByText("復旧状況を確認できていません。")).toBeVisible();
  });

  it("sorts affected components by severity and keeps healthy ones behind a toggle", () => {
    const github = service({
      components: [
        component("issues", "Issues", "major_outage"),
        component("api", "API Requests", "partial_outage"),
        component("actions", "Actions", "degraded_performance"),
        component("web", "Web", "unknown"),
        component("git", "Git Operations"),
      ],
    });
    render(<ServiceCard service={github} />);

    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    const visibleList = within(card).getByRole("list", { name: "表示中のコンポーネント" });
    expect(
      within(visibleList)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(["Issues", "API Requests", "Actions", "Web"]);
    expect(
      within(card).getByRole("button", { name: "正常なコンポーネント 1件を表示" }),
    ).toBeInTheDocument();
  });

  it("keeps a healthy component visible when it owns an incident", () => {
    const github = service({
      components: [
        component("actions", "Actions", "degraded_performance"),
        component("web", "Web"),
      ],
      incidents: [incident({ id: "web-1", title: "Web notice", componentIds: ["web"] })],
    });
    render(<ServiceCard service={github} />);

    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    const visibleList = within(card).getByRole("list", { name: "表示中のコンポーネント" });
    expect(
      within(visibleList).getByRole("listitem", { name: "Webコンポーネント" }),
    ).toBeInTheDocument();
    expect(within(card).getByRole("listitem", { name: "Web notice" })).toBeInTheDocument();
  });

  it.each([
    {
      name: "component IDs",
      componentIds: ["actions"],
      components: ["API Requests"],
      expectedComponent: "Actions",
    },
    {
      name: "component names when no ID matches",
      componentIds: ["removed-id"],
      components: ["API Requests"],
      expectedComponent: "API Requests",
    },
  ])("assigns incidents using $name", ({ componentIds, components, expectedComponent }) => {
    const github = service({
      components: [
        component("actions", "Actions", "partial_outage"),
        component("api", "API Requests"),
      ],
      incidents: [incident({ componentIds, components })],
    });
    render(<ServiceCard service={github} />);

    const componentRow = screen.getByRole("listitem", {
      name: `${expectedComponent}コンポーネント`,
    });
    expect(
      within(componentRow).getByRole("listitem", { name: "Messaging delays for some users" }),
    ).toBeInTheDocument();
  });

  it("assigns an incident to an affected component with abnormal status among several matches", () => {
    const github = service({
      components: [component("actions", "Actions", "partial_outage"), component("api", "API")],
      incidents: [
        incident({
          componentIds: ["api", "actions"],
          components: ["Actions", "API"],
        }),
      ],
    });
    render(<ServiceCard service={github} />);

    const affectedRow = screen.getByRole("listitem", { name: "Actionsコンポーネント" });
    expect(
      within(affectedRow).getByRole("listitem", { name: "Messaging delays for some users" }),
    ).toBeInTheDocument();
    const healthyList = document.getElementById("healthy-components-github")!;
    expect(
      within(healthyList).queryByRole("listitem", {
        name: "Messaging delays for some users",
        hidden: true,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows unmatched incidents separately and removes duplicate IDs", () => {
    const github = service({
      components: [component("actions", "Actions", "degraded_performance")],
      incidents: [
        incident({ id: "orphan-1", title: "Unmatched incident", componentIds: ["removed-id"] }),
        incident({ id: "orphan-1", title: "Duplicate incident", componentIds: ["actions"] }),
      ],
    });
    render(<ServiceCard service={github} />);

    const section = screen.getByRole("region", { name: "GitHubの障害・メンテナンス情報" });
    expect(
      within(section).getByRole("listitem", { name: "Unmatched incident" }),
    ).toBeInTheDocument();
    expect(
      within(section).queryByRole("listitem", { name: "Duplicate incident" }),
    ).not.toBeInTheDocument();
  });

  it("expands one component incident without opening its sibling", () => {
    const github = service({
      components: [component("actions", "Actions", "degraded_performance")],
      incidents: [
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
      ],
    });
    render(<ServiceCard service={github} />);

    const actionsRow = screen.getByRole("listitem", { name: "Actionsコンポーネント" });
    const selectedIncident = within(actionsRow).getByRole("listitem", { name: "Actions delay" });
    const siblingIncident = within(actionsRow).getByRole("listitem", {
      name: "Workflow queue delay",
    });
    fireEvent.click(within(selectedIncident).getByText("Actions delay"));

    expect(within(selectedIncident).getByText("Actions are delayed.")).toBeVisible();
    expect(within(siblingIncident).getByText("The workflow queue is delayed.")).not.toBeVisible();
  });

  it.each([
    { count: 1, components: [component("api", "API Requests")] },
    {
      count: 2,
      components: [component("api", "API Requests"), component("git", "Git Operations")],
    },
  ])("toggles all $count healthy components together", ({ count, components }) => {
    render(<ServiceCard service={service({ components })} />);

    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    const showButton = within(card).getByRole("button", {
      name: `正常なコンポーネント ${count}件を表示`,
    });
    const healthyList = document.getElementById(showButton.getAttribute("aria-controls")!)!;
    expect(healthyList).toHaveAttribute("hidden");

    fireEvent.click(showButton);
    expect(
      within(healthyList)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(components.map(({ name }) => name));

    fireEvent.click(within(card).getByRole("button", { name: "正常なコンポーネントを非表示" }));
    expect(healthyList).toHaveAttribute("hidden");
  });

  it("shows the official service status separately from each component status", () => {
    const affected = service({
      status: "major_outage",
      sourceStatus: "major_outage",
      components: [component("actions", "Actions", "partial_outage")],
    });
    render(<ServiceCard service={affected} />);

    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    expect(within(card).getByLabelText("公式全体ステータス: 全面障害")).toBeInTheDocument();
    expect(
      within(within(card).getByRole("listitem", { name: "Actionsコンポーネント" })).getByText(
        "部分障害",
      ),
    ).toBeInTheDocument();
  });
});
