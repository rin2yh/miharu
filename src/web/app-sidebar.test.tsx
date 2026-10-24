import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./app";
import { basePayload, githubLinkName } from "./test-fixtures";

describe("App sidebar layout", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("places a full-height divider between the desktop sidebar and main content", async () => {
    render(<App load={async () => basePayload} />);
    await screen.findByRole("link", { name: githubLinkName });

    const sidebar = screen.getByRole("complementary", { name: "サービス選択" });
    expect(sidebar).toHaveClass("hidden", "lg:block");

    const divider = screen.getByRole("separator");
    expect(divider).toHaveAttribute("aria-orientation", "vertical");
    expect(divider).toHaveClass("hidden", "h-full", "w-px", "bg-line", "lg:block");
    expect(divider.parentElement).toHaveClass("grid", "lg:grid-cols-[13rem_1px_minmax(0,1fr)]");
  });
});
