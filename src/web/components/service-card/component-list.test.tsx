import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DashboardComponent, DashboardIncident } from "../../../domain";
import { component, incident } from "../../test-fixtures";
import { ComponentList } from "./component-list";

function renderComponentList(
  components: DashboardComponent[],
  assignedIncidents: Map<string, DashboardIncident[]> = new Map(),
) {
  return render(
    <ComponentList
      serviceId="slack"
      serviceName="Slack"
      components={components}
      assignedIncidents={assignedIncidents}
    />,
  );
}

describe("ComponentList", () => {
  it("keeps all unknown feature statuses collapsed and never labels them healthy", () => {
    renderComponentList([
      { ...component("messaging", "Messaging", "unknown"), sourceStatus: "not_reported" },
      { ...component("huddles", "Huddles", "unknown"), sourceStatus: "not_reported" },
    ]);

    const section = screen.getByRole("region", { name: "Slackのコンポーネント" });
    const button = within(section).getByRole("button", {
      name: "状態不明のコンポーネント 2件を表示",
    });
    const unknownList = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(unknownList).toHaveAttribute("hidden");
    expect(within(section).queryByText("正常なコンポーネント 2件を表示")).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(
      within(unknownList)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(["Huddles", "Messaging"]);
    expect(within(unknownList).getAllByText("状態不明")).toHaveLength(2);
  });

  it("shows reported feature impact and folds other unknown features", () => {
    renderComponentList([
      { ...component("messaging", "Messaging", "unknown"), sourceStatus: "affected" },
      { ...component("huddles", "Huddles", "unknown"), sourceStatus: "not_reported" },
    ]);

    const section = screen.getByRole("region", { name: "Slackのコンポーネント" });
    const messaging = within(section).getByRole("listitem", { name: "Messagingコンポーネント" });
    expect(within(messaging).getByText("影響あり・程度不明")).toBeVisible();
    expect(
      within(section).getByRole("button", { name: "状態不明のコンポーネント 1件を表示" }),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole("listitem", { name: "Huddlesコンポーネント", hidden: true }),
    ).not.toBeVisible();
  });

  it("sorts affected components and folds healthy and unknown ones", () => {
    renderComponentList([
      component("issues", "Issues", "major_outage"),
      component("api", "API Requests", "partial_outage"),
      component("actions", "Actions", "degraded_performance"),
      component("web", "Web", "unknown"),
      component("git", "Git Operations"),
    ]);

    const section = screen.getByRole("region", { name: "Slackのコンポーネント" });
    const visibleList = within(section).getByRole("list", { name: "表示中のコンポーネント" });
    expect(
      within(visibleList)
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent),
    ).toEqual(["Issues", "API Requests", "Actions"]);
    expect(
      within(section).getByRole("button", { name: "正常なコンポーネント 1件を表示" }),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole("button", { name: "状態不明のコンポーネント 1件を表示" }),
    ).toBeInTheDocument();
  });

  it("keeps a healthy component visible when it owns an incident", () => {
    const webIncident = incident({ id: "web-1", title: "Web notice", componentIds: ["web"] });
    renderComponentList(
      [component("actions", "Actions", "degraded_performance"), component("web", "Web")],
      new Map([["web", [webIncident]]]),
    );

    const section = screen.getByRole("region", { name: "Slackのコンポーネント" });
    const visibleList = within(section).getByRole("list", { name: "表示中のコンポーネント" });
    expect(
      within(visibleList).getByRole("listitem", { name: "Webコンポーネント" }),
    ).toBeInTheDocument();
    expect(within(section).getByRole("listitem", { name: "Web notice" })).toBeInTheDocument();
  });

  it.each([
    { count: 1, components: [component("api", "API Requests")] },
    {
      count: 2,
      components: [component("api", "API Requests"), component("git", "Git Operations")],
    },
  ])("toggles all $count healthy components together", ({ count, components }) => {
    renderComponentList(components);

    const section = screen.getByRole("region", { name: "Slackのコンポーネント" });
    const showButton = within(section).getByRole("button", {
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

    fireEvent.click(within(section).getByRole("button", { name: "正常なコンポーネントを非表示" }));
    expect(healthyList).toHaveAttribute("hidden");
  });
});
