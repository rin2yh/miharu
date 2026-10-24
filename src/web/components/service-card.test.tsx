import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ServiceCard from "./service-card";
import { component, githubLinkName, incident, service, slackLinkName } from "../test-fixtures";

describe("ServiceCard", () => {
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

  it("shows a shared empty-state message when no component catalogue is available", () => {
    render(<ServiceCard service={service({ incidents: [incident()] })} />);

    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    expect(
      within(card).getByText("コンポーネント単位の状態情報は提供されていません。"),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("listitem", { name: "Messaging delays for some users" }),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole("list", { name: "表示中のコンポーネント" }),
    ).not.toBeInTheDocument();
  });

  it("shows Google Workspace as normal and collapses its healthy products", () => {
    render(
      <ServiceCard
        service={service({
          id: "google-workspace",
          name: "Google Workspace",
          statusPageUrl: "https://www.google.com/appsstatus/dashboard/",
          status: "operational",
          sourceStatus: "AVAILABLE",
          components: Array.from({ length: 35 }, (_, index) =>
            component(`product-${index}`, `Product ${index + 1}`),
          ),
        })}
      />,
    );

    const card = screen.getByRole("listitem", { name: "Google Workspaceのサービス状況" });
    expect(within(card).getByLabelText("公式全体ステータス: 正常")).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "正常なコンポーネント 35件を表示" }),
    ).toBeVisible();
    expect(within(card).queryByRole("list", { name: "表示中のコンポーネント" })).toBeNull();
    expect(within(card).queryByText("状態不明")).toBeNull();
  });

  it("shows the official service status separately from each component status", () => {
    render(
      <ServiceCard
        service={service({
          status: "major_outage",
          sourceStatus: "major_outage",
          components: [component("actions", "Actions", "partial_outage")],
        })}
      />,
    );

    const card = screen.getByRole("listitem", { name: "GitHubのサービス状況" });
    expect(within(card).getByLabelText("公式全体ステータス: 全面障害")).toBeInTheDocument();
    expect(
      within(within(card).getByRole("listitem", { name: "Actionsコンポーネント" })).getByText(
        "部分障害",
      ),
    ).toBeInTheDocument();
  });
});
