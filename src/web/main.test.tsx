import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRoot: vi.fn<(root: HTMLElement | null) => { render: (element: unknown) => void }>(),
  render: vi.fn<(element: unknown) => void>(),
}));

vi.mock("react-dom/client", () => ({ createRoot: mocks.createRoot }));
vi.mock("./app", () => ({ App: () => "dashboard" }));

describe("web entry point", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createRoot.mockReset().mockReturnValue({ render: mocks.render });
    mocks.render.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("mounts the App into the root element", async () => {
    const rootElement = document.getElementById("root");
    await import("./main");

    expect(mocks.createRoot).toHaveBeenCalledWith(rootElement);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.render.mock.calls[0]?.[0]).toMatchObject({ type: expect.any(Function) });
  });
});
