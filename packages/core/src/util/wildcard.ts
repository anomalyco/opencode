export * as Wildcard from "./wildcard"

const GS = "__OC_GS__"
const GSS = "__OC_GSS__"
const Q = "__OC_Q__"
const STAR = "__OC_STAR__"
const GSS_REPL = "(?:" + ".+/)" + "\x3F"

export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/\*\*\//g, GSS)
    .replace(/\*\*/g, GS)
    .replace(/\*/g, STAR)
    .replace(/\?/g, Q)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(new RegExp(GSS, "g"), GSS_REPL)
    .replace(new RegExp(GS, "g"), ".*")
    .replace(new RegExp(STAR, "g"), "[^/]*")
    .replace(new RegExp(Q, "g"), "[^/]")

  if (escaped.endsWith(" [^/]*")) escaped = escaped.slice(0, -6) + "( [^/]*)?"

  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}
