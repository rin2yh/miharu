import { describe, expect, it } from "vitest";
import { SERVICES } from "../../shared/config/services";
import { getSelectedServiceIds, getServiceSelectionUrl } from "./service-filter";

describe("service selection URL", () => {
  it("selects every service when the services parameter is absent", () => {
    expect(getSelectedServiceIds("?theme=dark")).toEqual(SERVICES.map((service) => service.id));
  });

  it("ignores unknown IDs and duplicates while keeping the configured order", () => {
    expect(getSelectedServiceIds("?services=github,unknown,slack,github")).toEqual([
      "slack",
      "github",
    ]);
  });

  it("returns an empty selection when every requested ID is unknown", () => {
    expect(getSelectedServiceIds("?services=unknown,missing")).toEqual([]);
  });

  it("removes the parameter when every service is selected", () => {
    expect(
      getServiceSelectionUrl(
        "https://miharu.example/?theme=dark&services=unknown#top",
        SERVICES.toReversed().map((service) => service.id),
      ),
    ).toBe("https://miharu.example/?theme=dark#top");
  });

  it("writes selected IDs in configured order and preserves other URL parts", () => {
    const result = new URL(
      getServiceSelectionUrl("https://miharu.example/?theme=dark#top", ["github", "slack"]),
    );

    expect(result.searchParams.get("services")).toBe("slack,github");
    expect(result.searchParams.get("theme")).toBe("dark");
    expect(result.hash).toBe("#top");
  });
});
