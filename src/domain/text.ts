export function toPlainText(value: unknown, maxLength = 3_000): string | null {
  if (typeof value !== "string") return null;
  const text = stripHtmlMarkup(decodeHtmlEntitiesOnce(value))
    .replace(/[\t ]*\n[\t ]*/g, "\n")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function stripHtmlMarkup(value: string): string {
  let previous: string;
  do {
    previous = value;
    value = value
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/<\s*br\b[^>]*(?:>|$)/gi, "\n")
      .replace(/<\s*\/\s*(?:p|div|li|ul|ol|blockquote|h[1-6])\b[^>]*(?:>|$)/gi, "\n")
      .replace(/<\s*\/?\s*[a-z][^>]*(?:>|$)/gi, "");
  } while (value !== previous);
  return value;
}

export function decodeHtmlEntitiesOnce(value: string): string {
  return value.replace(/&(?:nbsp|amp|lt|gt|quot|apos);|&#(?:\d+|x[\da-f]+);/gi, (entity) => {
    switch (entity.toLowerCase()) {
      case "&nbsp;":
        return " ";
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&#39;":
      case "&apos;":
        return "'";
      default: {
        const hexadecimal = /^&#x/i.test(entity);
        const point = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
      }
    }
  });
}
