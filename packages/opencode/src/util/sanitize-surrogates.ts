export function sanitizeSurrogates(s: string): string {
  if (typeof s !== "string" || s.length === 0) return s
  if (typeof s.isWellFormed === "function" && s.isWellFormed()) return s
  if (typeof s.toWellFormed === "function") return s.toWellFormed()
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
}
