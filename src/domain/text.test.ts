import { describe, expect, it } from "vitest";
import { toPlainText } from "./text";

describe("HTML text helpers", () => {
  it.each([
    {
      label: "converts markup and decodes nested entities once",
      input: "<p>one &amp;lt; two</p><p>three</p>",
      expected: "one &lt; two\n\nthree",
    },
    {
      label: "keeps markup revealed by decoding a text entity as text",
      input: "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
      expected: "<script>alert(1)</script>",
    },
    {
      label: "handles incomplete HTML tags",
      input: "<b>unfinished",
      expected: "unfinished",
    },
  ])("$label", ({ input, expected }) => {
    expect(toPlainText(input)).toBe(expected);
  });
});
