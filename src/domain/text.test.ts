import { describe, expect, it } from "vitest";
import { decodeHtmlEntitiesOnce, toPlainText } from "./text";

describe("HTML text helpers", () => {
  it("decodes each entity only once", () => {
    expect(decodeHtmlEntitiesOnce("&amp;lt;script&amp;gt; &#x3c;script&#62;")).toBe(
      "&lt;script&gt; <script>",
    );
  });

  it("removes markup revealed by entities, including an incomplete tag", () => {
    expect(
      toPlainText(
        "<p>hello &lt;script&gt;alert(1)&lt;/script&gt;</p><br>visible <script &lt;scrip&lt;script&gt;",
      ),
    ).toBe("hello alert(1)\n\nvisible");
  });

  it("repeats markup removal when a removed tag exposes another tag", () => {
    expect(toPlainText("<<b>script")).toBeNull();
  });
});
