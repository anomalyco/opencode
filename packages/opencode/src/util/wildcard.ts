import { sortBy, pipe } from "remeda"

const GS = "__OC_GS__"
const GSS = "__OC_GSS__"
const Q = "__OC_Q__"
const STAR = "__OC_STAR__"
const GSS_REPL = "(?:" + ".+/)" + "\x3F"

export function match(str: string, pattern: string) {
  if (str) str = str.replaceAll("\\", "/")
  if (pattern) pattern = pattern.replaceAll("\\", "/")
  let escaped = pattern
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

  const flags = process.platform === "win32" ? "si" : "s"
  return new RegExp("^" + escaped + "$", flags).test(str)
}

export function all(input: string, patterns: Record<string, any>) {
  const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
  let result = undefined
  for (const [pattern, value] of sorted) {
    if (match(input, pattern)) {
      result = value
      continue
    }
  }
  return result
}

export function allStructured(input: { head: string; tail: string[] }, patterns: Record<string, any>) {
  const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
  let result = undefined
  for (const [pattern, value] of sorted) {
    const parts = pattern.split(/\s+/)
    if (!match(input.head, parts[0])) continue
    if (parts.length === 1 || matchSequence(input.tail, parts.slice(1))) {
      result = value
      continue
    }
  }
  return result
}

function matchSequence(items: string[], patterns: string[]): boolean {
  if (patterns.length === 0) return true
  const [pattern, ...rest] = patterns
  if (pattern === "*") return matchSequence(items, rest)
  for (let i = 0; i < items.length; i++) {
    if (match(items[i], pattern) && matchSequence(items.slice(i + 1), rest)) {
      return true
    }
  }
  return false
}

export * as Wildcard from "./wildcard"
