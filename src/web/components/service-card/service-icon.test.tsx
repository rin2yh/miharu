import { render } from "@testing-library/react";
import { siClaude, siCloudflare, siGithub, siNotion } from "simple-icons";
import { describe, expect, it } from "vitest";
import { ServiceIcon } from "./service-icon";

describe("ServiceIcon", () => {
  it.each([
    { id: "cloudflare", name: "Cloudflare", icon: siCloudflare, invertInDark: false },
    { id: "notion", name: "Notion", icon: siNotion, invertInDark: true },
    { id: "github", name: "GitHub", icon: siGithub, invertInDark: true },
    { id: "claude", name: "Claude", icon: siClaude, invertInDark: false },
  ])("shows the $name brand icon", ({ id, name, icon, invertInDark }) => {
    const { container } = render(<ServiceIcon service={{ id, name }} />);
    const iconWrapper = container.querySelector("span");

    expect(iconWrapper?.querySelector("svg path")).toHaveAttribute("d", icon.path);
    expect(iconWrapper).toHaveStyle({ color: `#${icon.hex}` });
    expect(iconWrapper?.classList.contains("dark:[&>svg]:invert")).toBe(invertInDark);
  });

  it("uses a theme-colored SVG for ChatGPT", () => {
    const { container } = render(<ServiceIcon service={{ id: "chatgpt", name: "ChatGPT" }} />);
    const iconWrapper = container.querySelector("span");
    const iconPath = iconWrapper?.querySelector("svg path");

    expect(iconPath?.getAttribute("d")).toBeTruthy();
    expect(iconWrapper).toHaveClass("text-muted", "dark:text-ink");
    expect(iconWrapper).not.toHaveAttribute("style");
    expect(iconWrapper).not.toHaveClass("dark:[&>svg]:invert");
  });
});
