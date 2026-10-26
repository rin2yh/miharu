import { convert } from "html-to-text";

/** Converts upstream markup to display text. This is not an HTML sanitizer. */
export function toPlainText(value: unknown, maxLength = 3_000): string | null {
  if (typeof value !== "string") return null;
  const text = convert(value, { preserveNewlines: true, wordwrap: false })
    .replace(/[\t ]*\n[\t ]*/g, "\n")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}
