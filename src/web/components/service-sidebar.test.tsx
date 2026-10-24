import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SERVICES } from "../../shared/config/services";
import { ServiceSidebar } from "./service-sidebar";

describe("ServiceSidebar", () => {
  it("selects all services from a partial selection and clears all from the selected state", () => {
    const onSelect = vi.fn<(serviceIds: string[]) => void>();
    const onQueryChange = vi.fn<(query: string) => void>();
    const allServiceIds = SERVICES.map(({ id }) => id);
    const { rerender } = render(
      <ServiceSidebar
        selectedServiceIds={["github", "slack"]}
        onSelect={onSelect}
        query=""
        onQueryChange={onQueryChange}
      />,
    );
    const selectAllButton = screen.getByRole("button", { name: "すべて" });

    expect(selectAllButton).toHaveAttribute("aria-pressed", "mixed");
    fireEvent.click(selectAllButton);
    expect(onSelect).toHaveBeenLastCalledWith(allServiceIds);

    rerender(
      <ServiceSidebar
        selectedServiceIds={allServiceIds}
        onSelect={onSelect}
        query=""
        onQueryChange={onQueryChange}
      />,
    );
    expect(screen.getByRole("button", { name: "すべて" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "すべて" }));
    expect(onSelect).toHaveBeenLastCalledWith([]);

    rerender(
      <ServiceSidebar
        selectedServiceIds={[]}
        onSelect={onSelect}
        query=""
        onQueryChange={onQueryChange}
      />,
    );
    const emptyStateSelectAllButton = screen.getByRole("button", { name: "すべて" });
    expect(emptyStateSelectAllButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(emptyStateSelectAllButton);
    expect(onSelect).toHaveBeenLastCalledWith(allServiceIds);
  });

  it("gives selected services a background and leaves unselected services clear", () => {
    render(
      <ServiceSidebar
        selectedServiceIds={["github"]}
        onSelect={vi.fn<(serviceIds: string[]) => void>()}
        query=""
        onQueryChange={vi.fn<(query: string) => void>()}
      />,
    );
    const sidebar = screen.getByRole("complementary", { name: "サービス選択" });
    const githubButton = within(sidebar).getByRole("button", { name: "GitHub" });
    const slackButton = within(sidebar).getByRole("button", { name: "Slack" });

    expect(githubButton).toHaveAttribute("aria-pressed", "true");
    expect(githubButton).toHaveClass("bg-healthy-bg");
    expect(slackButton).toHaveAttribute("aria-pressed", "false");
    expect(slackButton).not.toHaveClass("bg-healthy-bg");
  });
});
