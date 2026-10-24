import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const imports = 'import { describe, expect, it } from "vitest";';

type Location = { line: number; column: number };
type Example = { name: string; source: string; target?: string };

function call(name: string, callback: string) {
  return 'it("' + name + '", ' + callback + ");";
}

function parseTest(name: string, input: string, expected: string) {
  return call(name, "() => expect(parse(" + input + ")).toBe(" + expected + ")");
}

function group(...tests: string[]) {
  return ['describe("suite", () => {', ...tests.map((test) => "  " + test), "});"].join("\n");
}

function fixture(...blocks: string[]) {
  return [imports, ...blocks].join("\n");
}

function fixtureWithImports(importStatement: string, ...blocks: string[]) {
  return [importStatement, ...blocks].join("\n");
}

function pair(first: string, second: string) {
  return fixture(group(first, second));
}

function shadowed(name: string) {
  return fixture(
    "function run(" + name + ") {",
    group(parseTest("first", "1", "1"), parseTest("second", "2", "2")),
    "}",
  );
}

function locationAt(source: string, target: string): Location {
  const lines = source.slice(0, source.indexOf(target)).split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function lint(source: string): Location[] {
  const directory = mkdtempSync(join(root, "tools/oxlint/.fixture-"));
  const path = join(directory, "cases.test.ts");

  try {
    writeFileSync(path, source);
    const result = spawnSync(
      resolve(root, "node_modules/.bin/oxlint"),
      [
        "--config",
        resolve(root, ".oxlintrc.json"),
        "--format",
        "json",
        "-A",
        "eslint/no-unused-vars",
        path,
      ],
      { cwd: root, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        "Oxlint exited with " + result.status + ":\n" + result.stdout + result.stderr,
      );
    }

    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string; labels: Array<{ span: Location }> }>;
    };
    return output.diagnostics
      .filter(({ code }) => code === "miharu(prefer-table-driven-tests)")
      .map(({ labels }) => ({
        line: labels[0].span.line,
        column: labels[0].span.column,
      }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const examples: Example[] = [
  {
    name: "reports once at the second of three matching tests with import aliases",
    source: fixtureWithImports(
      'import { describe as suite, it, test as check, expect as assert } from "vitest";',
      'suite("suite", () => {',
      '  it("first", () => assert(parse("a")).toBe("x"));',
      '  check("second", () => assert(parse("b")).toBe("y"));',
      '  it("third", () => assert(parse("c")).toBe("z"));',
      "});",
    ),
    target: 'check("second", () => assert(parse("b")).toBe("y"));',
  },
  {
    name: "ignores different AST structures",
    source: pair(
      call("reads", '() => expect(readValue("a")).toBe("a")'),
      call("writes", '() => expect(writeValue("b")).toBe("b")'),
    ),
  },
  {
    name: "keeps separate describe blocks independent",
    source: fixture(group(parseTest("case", "1", "1")), group(parseTest("case", "2", "2"))),
  },
  {
    name: "ignores identical literal values",
    source: pair(parseTest("first", '"a"', '"a"'), parseTest("second", '"a"', '"a"')),
  },
  { name: "ignores a shadowed it import", source: shadowed("it") },
  { name: "ignores a shadowed describe import", source: shadowed("describe") },
  {
    name: "ignores a collection mutation",
    source: pair(
      call("first", '() => expect(queue.shift()).toBe("a")'),
      call("second", '() => expect(queue.shift()).toBe("b")'),
    ),
  },
  {
    name: "ignores update expressions",
    source: pair(
      call("first", "() => expect(++count).toBe(1)"),
      call("second", "() => expect(++count).toBe(2)"),
    ),
  },
  {
    name: "ignores asynchronous callbacks",
    source: pair(
      call("first", "async () => expect(await parse(1)).toBe(1)"),
      call("second", "async () => expect(await parse(2)).toBe(2)"),
    ),
  },
  {
    name: "ignores nested functions",
    source: pair(
      call("first", '() => expect(() => parse(1)).toThrow("one")'),
      call("second", '() => expect(() => parse(2)).toThrow("two")'),
    ),
  },
  {
    name: "ignores multi-statement callbacks",
    source: pair(
      call("first", "() => { setup(1); expect(parse(1)).toBe(1); }"),
      call("second", "() => { setup(2); expect(parse(2)).toBe(2); }"),
    ),
  },
  {
    name: "ignores tests already using each",
    source: fixture(
      group(
        'it.each([[1, 1], [2, 2]])("maps", (input, expected) => {',
        "  expect(parse(input)).toBe(expected);",
        "});",
      ),
    ),
  },
];

describe("prefer-table-driven-tests Oxlint rule", () => {
  it.each(examples)("$name", ({ source, target }) => {
    expect(lint(source)).toEqual(target ? [locationAt(source, target)] : []);
  });
});
