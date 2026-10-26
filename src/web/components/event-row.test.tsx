import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { event } from "../test-fixtures";
import { EventRow } from "./event-row";

const labels = [
  { kind: "incident", eventKind: "opened", label: "障害発生" },
  { kind: "incident", eventKind: "updated", label: "障害更新" },
  { kind: "incident", eventKind: "resolved", label: "復旧" },
  { kind: "incident", eventKind: "closed", label: "追跡終了" },
  { kind: "maintenance", eventKind: "opened", label: "メンテナンス予定" },
  { kind: "maintenance", eventKind: "updated", label: "メンテナンス更新" },
  { kind: "maintenance", eventKind: "resolved", label: "メンテナンス完了" },
  { kind: "maintenance", eventKind: "closed", label: "追跡終了" },
] as const;

describe("EventRow", () => {
  it.each([
    { displayCategory: "notice", label: "お知らせ掲載" },
    { displayCategory: "unknown", label: "分類不明掲載" },
  ] as const)("uses $displayCategory for history", ({ displayCategory, label }) => {
    render(<EventRow event={event({ displayCategory })} />);
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText("障害発生")).not.toBeInTheDocument();
  });
  it.each(labels)("labels $kind $eventKind events as $label", ({ kind, eventKind, label }) => {
    render(
      <EventRow
        event={event({
          kind,
          eventKind,
          displayCategory: kind === "maintenance" ? "maintenance" : "outage",
        })}
      />,
    );

    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Actions delay" })).toHaveAttribute(
      "href",
      "https://www.githubstatus.com/incidents/incident-1",
    );
    expect(screen.getByText(/公式時刻/)).toBeInTheDocument();
  });

  it("shows the title without a link or official time when those details are absent", () => {
    render(<EventRow event={event({ url: null, officialEventAt: null })} />);

    expect(screen.getByText("Actions delay")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Actions delay" })).not.toBeInTheDocument();
    expect(screen.queryByText(/公式時刻/)).not.toBeInTheDocument();
  });
});
