import { describe, expect, it } from "vitest";
import { getErrorDiagnostics } from "./error-diagnostics";

describe("getErrorDiagnostics", () => {
  it("keeps the original message and nested cause chain", () => {
    const root = new Error("D1 socket closed");
    const error = new Error("Failed to save snapshot", { cause: root });
    expect(getErrorDiagnostics(error)).toEqual({
      errorType: "Error",
      errorMessage: "Failed to save snapshot",
      errorCause: "Error: D1 socket closed",
    });
  });

  it("records thrown strings as a message", () => {
    expect(getErrorDiagnostics("KV unavailable")).toEqual({
      errorType: "UnknownError",
      errorMessage: "KV unavailable",
    });
  });
});
