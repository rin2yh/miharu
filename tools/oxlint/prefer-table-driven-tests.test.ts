import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function lintFixture(source: string) {
  const temporaryDirectory = mkdtempSync(join(repositoryRoot, "tools/oxlint/.fixture-"));
  const fixturePath = join(temporaryDirectory, "cases.test.ts");

  try {
    writeFileSync(fixturePath, source);
    const result = spawnSync(
      resolve(repositoryRoot, "node_modules/.bin/oxlint"),
      ["--config", resolve(repositoryRoot, ".oxlintrc.json"), "--format", "json", fixturePath],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Oxlint exited with ${result.status}:\n${result.stdout}\n${result.stderr}`);
    }

    return JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string; message: string; messageId?: string }>;
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

describe("prefer-table-driven-tests Oxlint rule", () => {
  it("warns for matching literal-driven cases and skips unsuitable tests", () => {
    const results = lintFixture(`
      import { describe, expect, it, test as check } from "vitest";

      describe("parse status", () => {
        it("maps healthy", () => expect(parse("ok")).toBe("operational"));
        it("maps broken", () => expect(parse("broken")).toBe("outage"));
        it("maps unknown", () => expect(parse("other")).toBe("unknown"));
      });

      describe("aliased test function", () => {
        check("maps one", () => expect(normalize(1)).toBe("one"));
        check("maps two", () => expect(normalize(2)).toBe("two"));
      });

      describe("different operations", () => {
        it("reads a value", () => expect(readValue("a")).toBe("a"));
        it("writes a value", () => expect(writeValue("b")).toBe("b"));
      });

      describe("explicit mutation", () => {
        let count = 0;
        it("increments once", () => expect(++count).toBe(1));
        it("increments twice", () => expect(++count).toBe(2));
      });

      describe("same literal values", () => {
        it("has a first name", () => expect(format("name")).toBe("name"));
        it("has another name", () => expect(format("name")).toBe("name"));
      });

      describe("already parameterized", () => {
        it.each([[1, "one"], [2, "two"]])("normalizes %s", (input, expected) => {
          expect(normalize(input)).toBe(expected);
        });
      });
    `);

    const ruleDiagnostics = results.diagnostics.filter(
      ({ code }) => code === "miharu(prefer-table-driven-tests)",
    );

    expect(ruleDiagnostics).toHaveLength(2);
    expect(ruleDiagnostics[0]?.message).toContain("consider it.each() or test.each()");
    expect(ruleDiagnostics[1]?.message).toContain("consider it.each() or test.each()");
  });
});
