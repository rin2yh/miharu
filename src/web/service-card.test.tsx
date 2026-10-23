import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./app";
import {
  basePayload,
  component,
  githubLinkName,
  incident,
  lastSuccessAt,
  payload,
  service,
  slackLinkName,
} from "./test-fixtures";

describe("service cards", () => {
  it("links each service name to its official status page and shows incidents without a component catalogue", async () => {
    render(<App load={async () => basePayload} />);

    expect(screen.getByRole("link", { name: "miharu ホーム" })).toBeInTheDocument();
    expect(screen.queryByText(/公式情報を1分ごとに確認|画面更新 1分/)).not.toBeInTheDocument();
    expect(await screen.findByText("Messaging delays for some users")).toBeInTheDocument();
    const slackLink = screen.getByRole("link", { name: slackLinkName });
    expect(slackLink).toHaveAttribute("href", "https://slack-status.com/");
    expect(slackLink).toHaveAttribute("target", "_blank");
    const slackCard = screen.getByRole("listitem", { name: "Slackのサービス状況" });
    expect(within(slackCard!).getAllByRole("link", { name: /公式ステータスページ/ })).toHaveLength(
      1,
    );
    expect(within(slackCard!).queryByRole("link", { name: "公式" })).not.toBeInTheDocument();
    expect(within(slackCard!).getByLabelText("公式全体ステータス: 正常")).toBeInTheDocument();
    expect(
      within(slackCard!).queryByText("独立したコンポーネント状態は公式APIから提供されていません。"),
    ).not.toBeInTheDocument();
    expect(
      within(slackCard!).queryByRole("button", { name: /正常なコンポーネント/ }),
    ).not.toBeInTheDocument();
    const slackIncident = within(slackCard!).getByRole("listitem", {
      name: "Messaging delays for some users",
    });
    const slackIncidentTitle = within(slackIncident).getByText("Messaging delays for some users");
    expect(within(slackIncident).getByText("調査中")).toBeInTheDocument();
    expect(
      within(slackIncident)
        .getAllByRole("time")
        .find((time) => time.getAttribute("datetime") === "2026-10-23T04:55:00.000Z"),
    ).toBeInTheDocument();
    expect(within(slackIncident).getByText("We are investigating.")).not.toBeVisible();
    fireEvent.click(slackIncidentTitle);
    expect(within(slackIncident).getByText("障害の重要度: 部分障害")).toBeInTheDocument();
    expect(within(slackIncident).getByText("We are investigating.")).toBeInTheDocument();
    expect(
      within(slackIncident)
        .getAllByRole("time")
        .map((time) => time.getAttribute("datetime")),
    ).toContain("2026-10-23T04:50:00.000Z");
  });

  it("keeps incidents visible under one component and expands their details independently", async () => {
    const github = service({
      status: "operational",
      components: [
        component("web", "Web", "degraded_performance"),
        component("packages", "Packages"),
        component("actions", "Actions", "degraded_performance"),
        component("issues", "Issues", "major_outage"),
        component("api", "API Requests"),
      ],
      incidents: [
        incident({ id: "actions-1", title: "Actions delay", componentIds: ["actions"] }),
        incident({
          id: "actions-2",
          title: "Workflow queue delay",
          componentIds: ["actions", "web"],
        }),
        incident({
          id: "package-1",
          title: "Package notice",
          componentIds: [],
          components: ["Packages"],
        }),
        incident({
          id: "orphan-1",
          title: "Unmatched incident",
          componentIds: ["removed-id"],
          components: ["Removed component"],
        }),
      ],
    });
    render(<App load={async () => payload([github])} />);

    await screen.findByRole("link", { name: githubLinkName });
    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    expect(within(card!).getByLabelText("公式全体ステータス: 正常")).toBeInTheDocument();
    const visibleList = within(card!).getByRole("list", { name: "表示中のコンポーネント" });
    const healthyToggle = within(card!).getByRole("button", {
      name: "正常なコンポーネント 1件を表示",
    });
    const healthyList = document.getElementById(healthyToggle.getAttribute("aria-controls")!)!;
    const componentHeadings = within(visibleList).getAllByRole("heading", { level: 4 });
    expect(componentHeadings.map((heading) => heading.textContent)).toEqual([
      "Issues",
      "Actions",
      "Web",
      "Packages",
    ]);
    expect(componentHeadings).toHaveLength(4);
    expect(healthyList).toHaveAttribute("hidden");
    const actionsRow = within(visibleList).getByRole("listitem", {
      name: "Actionsコンポーネント",
    });
    expect(within(actionsRow).queryByRole("button", { name: /^Actions$/ })).toBeNull();
    expect(within(actionsRow).getAllByText("詳細", { exact: true })).toHaveLength(2);
    const firstActionIncident = within(actionsRow).getByRole("listitem", { name: "Actions delay" });
    const firstActionTitle = within(firstActionIncident).getByText("Actions delay");
    expect(within(actionsRow).getByText("Workflow queue delay")).toBeVisible();
    expect(within(firstActionIncident).getByText("調査中")).toBeInTheDocument();
    expect(within(firstActionIncident).getByText("We are investigating.")).not.toBeVisible();
    fireEvent.click(firstActionTitle);
    expect(within(firstActionIncident).getByText("We are investigating.")).toBeInTheDocument();
    expect(
      within(firstActionIncident).getByRole("link", { name: "公式情報を見る" }),
    ).toHaveAttribute("href", "https://www.githubstatus.com/incidents/incident-1");
    expect(within(firstActionIncident).getByText(/公式発生/)).toBeInTheDocument();
    const actionTimes = within(firstActionIncident)
      .getAllByRole("time")
      .map((time) => time.getAttribute("datetime"));
    expect(actionTimes).toContain("2026-10-23T04:50:00.000Z");
    expect(actionTimes).toContain("2026-10-23T04:55:00.000Z");
    const directIncidentRegion = within(card!).getByRole("region", {
      name: "GitHubの障害・メンテナンス情報",
    });
    expect(
      within(directIncidentRegion).getByRole("listitem", { name: "Unmatched incident" }),
    ).toBeVisible();
    expect(
      within(card!).getByRole("heading", { name: "その他の障害・メンテナンス情報" }),
    ).toBeVisible();
    expect(within(card!).getAllByText("詳細", { exact: true })).toHaveLength(4);

    fireEvent.click(healthyToggle);
    expect(healthyList).not.toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "正常なコンポーネントを非表示" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const packageRow = within(visibleList).getByRole("listitem", {
      name: "Packagesコンポーネント",
    });
    expect(within(packageRow).getByText("Package notice")).toBeInTheDocument();
    expect(within(card!).getAllByText("Package notice", { exact: true })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "正常なコンポーネントを非表示" }));
    expect(healthyList).toHaveAttribute("hidden");
    fireEvent.click(healthyToggle);
    expect(within(card!).getAllByText("Package notice")).toHaveLength(1);
    expect(within(card!).getAllByText("詳細", { exact: true })).toHaveLength(4);
    fireEvent.click(firstActionTitle);
    expect(within(firstActionIncident).getByText("We are investigating.")).not.toBeVisible();
    fireEvent.click(firstActionTitle);
    expect(within(firstActionIncident).getByText("We are investigating.")).toBeVisible();
    expect(within(actionsRow).getAllByText("Actions delay", { exact: true })).toHaveLength(1);
  });

  it("hides every healthy component initially and toggles the whole list", async () => {
    const github = service({
      components: [component("api", "API Requests"), component("git", "Git Operations")],
    });
    render(<App load={async () => payload([github])} />);

    await screen.findByRole("link", { name: githubLinkName });
    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    const healthyToggle = within(card!).getByRole("button", {
      name: "正常なコンポーネント 2件を表示",
    });
    const healthyList = document.getElementById(healthyToggle.getAttribute("aria-controls")!)!;
    expect(healthyList).toHaveAttribute("hidden");
    expect(
      within(card!).getByRole("button", { name: "正常なコンポーネント 2件を表示" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(healthyList).queryByRole("button", { name: /詳細/, hidden: true }),
    ).not.toBeInTheDocument();
    expect(
      within(healthyList).getByRole("heading", { name: "API Requests", hidden: true }),
    ).toBeInTheDocument();

    fireEvent.click(healthyToggle);
    expect(healthyList).not.toHaveAttribute("hidden");
    expect(screen.getByText("API Requests")).toBeInTheDocument();
    expect(screen.getByText("Git Operations")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "正常なコンポーネントを非表示" }));
    expect(healthyList).toHaveAttribute("hidden");
  });

  it("shows multiple abnormal components and leaves components without details non-interactive", async () => {
    const github = service({
      components: [
        component("api", "API Requests", "partial_outage"),
        component("actions", "Actions", "degraded_performance"),
        component("web", "Web", "unknown"),
        component("git", "Git Operations"),
      ],
    });
    render(<App load={async () => payload([github])} />);

    await screen.findByRole("link", { name: githubLinkName });
    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    const visibleList = within(card!).getByRole("list", { name: "表示中のコンポーネント" });
    const componentHeadings = within(visibleList).getAllByRole("heading", { level: 4 });
    expect(componentHeadings.map((heading) => heading.textContent)).toEqual([
      "API Requests",
      "Actions",
      "Web",
    ]);
    expect(within(visibleList).queryByRole("button")).not.toBeInTheDocument();
    expect(within(visibleList).queryByRole("heading", { level: 5 })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "正常なコンポーネント 1件を表示" }),
    ).toBeInTheDocument();
  });

  it("shows the official service outage separately from component outage", async () => {
    const affected = service({
      status: "major_outage",
      sourceStatus: "major_outage",
      components: [
        {
          id: "actions",
          name: "Actions",
          status: "major_outage",
          sourceStatus: "major_outage",
          lastChangedAt: lastSuccessAt,
        },
      ],
    });
    render(<App load={async () => payload([affected])} />);

    await screen.findByRole("link", { name: githubLinkName });
    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    expect(within(card!).getAllByText("全面障害")).toHaveLength(2);
    expect(within(card!).getByLabelText("公式全体ステータス: 全面障害")).toBeInTheDocument();
    expect(within(card!).getByText("Actions")).toBeInTheDocument();
  });
});
