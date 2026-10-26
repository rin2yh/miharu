/** Creates a deterministic identifier from provider-independent string parts. */
export function stableId(namespace: string, fields: Array<string | null>): string {
  const input = `${namespace}\u001f${fields.map((field) => field ?? "").join("\u001f")}`;
  let hash = 14_695_981_039_346_656_037n;
  for (const point of input) {
    hash ^= BigInt(point.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  return `generated_${hash.toString(16).padStart(16, "0")}`;
}
