import { describe, expect, it } from "vitest";
import { getErrorDiagnostics } from "./error-diagnostics";

describe("getErrorDiagnostics", () => {
  it("keeps the original message and nested cause chain", () => {
    const root = new Error("D1 socket closed");
    const error = new Error("Failed to save snapshot", { cause: root });
    expect(getErrorDiagnostics(error)).toEqual({
      errorType: "Error",
      errorCategory: "notification",
      errorMessage: "Failed to save snapshot",
      errorCause: "Error: D1 socket closed",
    });
  });

  it("records thrown strings as a message", () => {
    expect(getErrorDiagnostics("KV unavailable")).toEqual({
      errorType: "UnknownError",
      errorCategory: "cron",
      errorMessage: "KV unavailable",
    });
  });

  it("bounds very large messages and cause chains", () => {
    const diagnostics = getErrorDiagnostics(
      new Error("x".repeat(20_000), { cause: "y".repeat(20_000) }),
    );
    expect(
      (diagnostics.errorMessage?.length ?? 0) + (diagnostics.errorCause?.length ?? 0),
    ).toBeLessThanOrEqual(8_000);
    expect(`${diagnostics.errorMessage}${diagnostics.errorCause}`).toContain(
      "truncated at 8000 characters",
    );
  });

  it("classifies provider and storage errors by their source type", () => {
    expect(
      getErrorDiagnostics(
        Object.assign(new Error("Upstream returned 500"), { name: "ProviderError" }),
      ).errorCategory,
    ).toBe("external_api");
    expect(
      getErrorDiagnostics(Object.assign(new Error("KV unavailable"), { name: "KVError" }))
        .errorCategory,
    ).toBe("KV");
    expect(
      getErrorDiagnostics(Object.assign(new Error("save failed"), { name: "CollectionStoreError" }))
        .errorCategory,
    ).toBe("D1");
  });
});
