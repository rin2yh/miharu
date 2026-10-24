import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppSidebar } from "./app-sidebar";

describe("AppSidebar", () => {
  it("places a full-height divider between the desktop sidebar and main content", () => {
    render(
      <AppSidebar
        orderedServices={[]}
        selectedServiceIds={[]}
        onSelect={() => {}}
        query=""
        onQueryChange={() => {}}
      >
        <section aria-label="メインコンテンツ">サービス一覧</section>
      </AppSidebar>,
    );

    const sidebar = screen.getByRole("complementary", { name: "サービス選択" });
    expect(sidebar).toHaveClass(
      "hidden",
      "lg:block",
      "lg:sticky",
      "lg:self-start",
      "lg:overflow-y-auto",
    );
    expect(within(sidebar).getByRole("link", { name: "miharu ホーム" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(sidebar).getByRole("navigation", { name: "表示サービス" })).not.toHaveClass(
      "overflow-y-auto",
    );

    const divider = screen.getByRole("separator");
    expect(divider).toHaveAttribute("aria-orientation", "vertical");
    expect(divider).toHaveClass("hidden", "h-full", "w-px", "bg-line", "lg:block");
    expect(divider.parentElement).toHaveClass("grid", "lg:grid-cols-[13rem_1px_minmax(0,1fr)]");
    expect(screen.getByRole("region", { name: "メインコンテンツ" })).toHaveTextContent(
      "サービス一覧",
    );
  });
});
