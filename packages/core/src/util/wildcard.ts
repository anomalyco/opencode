export * as Wildcard from "./wildcard"

export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  // Escaped glob characters (\*, \?, \\) must match literally, so keep them
  // aside before the remaining backslashes are normalized to path separators.
  let escaped = pattern
    .replace(/\\[*?\\]/g, (value) => (value === "\\*" ? "\u0001" : value === "\\?" ? "\u0002" : "\u0003"))
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
    .replace(/[\u0001\u0002\u0003]/g, (value) => (value === "\u0001" ? "\\*" : value === "\u0002" ? "\\?" : "/"))

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}
