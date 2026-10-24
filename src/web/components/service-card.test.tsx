import { fireEvent, render, screen, within } from "@testing-library/react";
import { siClaude, siCloudflare, siGithub, siNotion } from "simple-icons";
import { describe, expect, it } from "vitest";
import { INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS } from "../../domain";
import { App } from "../app";
import {
  basePayload,
  component,
  githubLinkName,
  incident,
  payload,
  service,
  slackLinkName,
} from "../test-fixtures";

describe("service card icons", () => {
  it.each([
    { id: "cloudflare", name: "Cloudflare", icon: siCloudflare, invertInDark: false },
    { id: "notion", name: "Notion", icon: siNotion, invertInDark: true },
    { id: "github", name: "GitHub", icon: siGithub, invertInDark: true },
    { id: "claude", name: "Claude", icon: siClaude, invertInDark: false },
  ])("shows the $name brand icon", async ({ id, name, icon, invertInDark }) => {
    render(<App load={async () => payload([service({ id, name })])} />);

    const card = await screen.findByRole("listitem", { name: `${name}のサービス状況` });
    const iconWrapper = card.querySelector("header > span");

    expect(iconWrapper?.querySelector("svg path")).toHaveAttribute("d", icon.path);
    expect(iconWrapper).toHaveStyle({ color: `#${icon.hex}` });
    if (invertInDark) {
      expect(iconWrapper).toHaveClass("dark:[&>svg]:invert");
    } else {
      expect(iconWrapper).not.toHaveClass("dark:[&>svg]:invert");
    }
  });

  it("uses a theme-colored SVG for ChatGPT", async () => {
    render(<App load={async () => payload([service({ id: "chatgpt", name: "ChatGPT" })])} />);

    const card = await screen.findByRole("listitem", { name: "ChatGPTのサービス状況" });
    const iconWrapper = card.querySelector("header > span");
    const iconPath = iconWrapper?.querySelector("svg path");

    expect(iconPath?.getAttribute("d")).toBeTruthy();
    expect(iconWrapper).toHaveClass("text-muted", "dark:text-ink");
    expect(iconWrapper).not.toHaveAttribute("style");
    expect(iconWrapper).not.toHaveClass("dark:[&>svg]:invert");
  });
});

describe("service status links", () => {
  it.each([
    {
      serviceName: "Slack",
      linkName: slackLinkName,
      statusPageUrl: "https://slack-status.com/",
    },
    {
      serviceName: "GitHub",
      linkName: githubLinkName,
      statusPageUrl: "https://www.githubstatus.com/",
    },
  ])("$serviceName links to its official status page", async ({ linkName, statusPageUrl }) => {
    render(<App load={async () => basePayload} />);

    const statusPageLink = await screen.findByRole("link", { name: linkName });
    expect(statusPageLink).toHaveAttribute("href", statusPageUrl);
    expect(statusPageLink).toHaveAttribute("target", "_blank");
  });
});

describe("dashboard header", () => {
  it("links the product name home without repeating the polling schedule", () => {
    render(<App load={async () => basePayload} />);

    expect(screen.getByRole("link", { name: "miharu ホーム" })).toBeInTheDocument();
    expect(screen.queryByText(/公式情報を1分ごとに確認|画面更新 1分/)).not.toBeInTheDocument();
  });
});

describe("service card incidents", () => {
  it("shows incidents even when the service has no component catalogue", async () => {
    render(<App load={async () => basePayload} />);

    const slackCard = await screen.findByRole("listitem", { name: "Slackのサービス状況" });
    expect(
      within(slackCard).getByRole("listitem", { name: "Messaging delays for some users" }),
    ).toBeInTheDocument();
    expect(
      within(slackCard).queryByRole("list", { name: "表示中のコンポーネント" }),
    ).not.toBeInTheDocument();
  });

  it("reveals an incident's official details when its summary is opened", async () => {
    render(<App load={async () => payload([service({ incidents: [incident()] })])} />);

    const incidentItem = await screen.findByRole("listitem", {
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

  it("explains why an incident with an unknown recovery state remains visible", async () => {
    const unknownIncident = incident({
      id: "unknown-chatgpt-incident",
      title: "Earlier ChatGPT issue",
      body: null,
      state: "unknown",
      sourceStatus: INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
      severityStatus: null,
    });
    render(<App load={async () => payload([service({ incidents: [unknownIncident] })])} />);

    const incidentItem = await screen.findByRole("listitem", {
      name: unknownIncident.title,
    });
    expect(within(incidentItem).getByText("状態不明")).toBeVisible();
    fireEvent.click(within(incidentItem).getByText(unknownIncident.title));

    expect(within(incidentItem).getByText("復旧状況を確認できていません。")).toBeVisible();
  });
});

describe("component lists", () => {
  it("sorts affected components by severity and keeps healthy ones behind the toggle", async () => {
    const github = service({
      components: [
        component("issues", "Issues", "major_outage"),
        component("api", "API Requests", "partial_outage"),
        component("actions", "Actions", "degraded_performance"),
        component("web", "Web", "unknown"),
        component("git", "Git Operations"),
      ],
    });
    render(<App load={async () => payload([github])} />);

    const card = await screen.findByRole("listitem", { name: "GitHubのサービス状況" });
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

  it("keeps incident-bearing healthy components visible and separates unmatched incidents", async () => {
    const github = service({
      components: [
        component("actions", "Actions", "degraded_performance"),
        component("packages", "Packages"),
        component("web", "Web"),
      ],
      incidents: [
        incident({ id: "package-1", title: "Package notice", components: ["Packages"] }),
        incident({
          id: "orphan-1",
          title: "Unmatched incident",
          componentIds: ["removed-id"],
          components: ["Removed component"],
        }),
      ],
    });
    render(<App load={async () => payload([github])} />);

    const card = await screen.findByRole("listitem", { name: "GitHubのサービス状況" });
    const visibleList = within(card).getByRole("list", { name: "表示中のコンポーネント" });
    expect(
      within(visibleList)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(["Actions", "Packages"]);
    expect(within(card).getByRole("listitem", { name: "Package notice" })).toBeInTheDocument();
    expect(
      within(
        within(card).getByRole("region", { name: "GitHubの障害・メンテナンス情報" }),
      ).getByRole("listitem", { name: "Unmatched incident" }),
    ).toBeInTheDocument();
  });

  it("expands one component incident without opening its sibling", async () => {
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
    render(<App load={async () => payload([github])} />);

    const actionsRow = await screen.findByRole("listitem", { name: "Actionsコンポーネント" });
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
  ])("toggles all $count healthy components together", async ({ count, components }) => {
    render(<App load={async () => payload([service({ components })])} />);

    const card = await screen.findByRole("listitem", { name: "GitHubのサービス状況" });
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

  it("shows the official service status separately from each component status", async () => {
    const affected = service({
      status: "major_outage",
      sourceStatus: "major_outage",
      components: [component("actions", "Actions", "partial_outage")],
    });
    render(<App load={async () => payload([affected])} />);

    const card = await screen.findByRole("listitem", { name: "GitHubのサービス状況" });
    expect(within(card).getByLabelText("公式全体ステータス: 全面障害")).toBeInTheDocument();
    expect(
      within(within(card).getByRole("listitem", { name: "Actionsコンポーネント" })).getByText(
        "部分障害",
      ),
    ).toBeInTheDocument();
  });
});
