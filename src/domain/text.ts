export function toPlainText(value: unknown, maxLength = 3_000): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|div|li|ul|ol|blockquote|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);|&#x([\da-f]+);/gi, (_entity, decimal: string, hex: string) => {
      const point = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/[\t ]*\n[\t ]*/g, "\n")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}
