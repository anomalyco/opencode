// The record-per-line JSON layout of the oracle fixtures. `records(value, paths)` returns the same JSON value
// as `JSON.stringify(value)`, with the same key order, but laid out so that each record (one test case) sits
// on one compact line. A re-record then diffs one line per changed case, and readers keep parsing it with
// `serde_json::from_str` or `JSON.parse`.
//
// A path names the records, segment by segment: a key, `*` for any object key, `[]` for any array element,
// and `**` for any number of segments. `cases[]` makes each element of `cases` a record, `routes.*` each
// value of `routes`, `scenarios[].cases[]` each case of each scenario, `**.flags[]` each flag at any depth.
// A container that holds a record is expanded with one key or element per line; everything else is written
// compact on the line of its key.
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Step = string | number

export function records(value: unknown, paths: string[]) {
  const patterns = paths.map((path) => path.split(".").flatMap(segments))
  return render(JSON.parse(JSON.stringify(value)) as Json, [], patterns, "") + "\n"
}

function segments(segment: string) {
  const name = segment.replace(/(\[\])+$/, "")
  const arrays = Array.from({ length: (segment.length - name.length) / 2 }, () => "[]")
  return name === "" ? arrays : [name, ...arrays]
}

function render(value: Json, path: Step[], patterns: string[][], indent: string): string {
  if (value === null || typeof value !== "object" || !holds(value, path, patterns)) return JSON.stringify(value)
  const inner = indent + " "
  const entries = Array.isArray(value)
    ? value.map((item, index) => inner + render(item, [...path, index], patterns, inner))
    : Object.entries(value).map(
        ([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, [...path, key], patterns, inner)}`,
      )
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"]
  return entries.length === 0 ? open + close : `${open}\n${entries.join(",\n")}\n${indent}${close}`
}

// Whether a record lies strictly below this container.
function holds(value: Json[] | { [key: string]: Json }, path: Step[], patterns: string[][]): boolean {
  return Object.entries(value).some(([key, item]) => {
    const child = [...path, Array.isArray(value) ? Number(key) : key]
    const found = patterns.map((pattern) => match(pattern, child))
    if (found.includes("record")) return true
    return found.includes("prefix") && item !== null && typeof item === "object" && holds(item, child, patterns)
  })
}

function match(pattern: string[], path: Step[]): "record" | "prefix" | undefined {
  if (path.length === 0) return pattern.every((segment) => segment === "**") ? "record" : "prefix"
  if (pattern.length === 0) return undefined
  if (pattern[0] === "**") {
    const here = match(pattern.slice(1), path)
    return here === "record" ? here : (match(pattern, path.slice(1)) ?? here)
  }
  if (!fits(pattern[0], path[0])) return undefined
  return match(pattern.slice(1), path.slice(1))
}

function fits(segment: string, step: Step) {
  if (segment === "[]") return typeof step === "number"
  if (segment === "*") return typeof step === "string"
  return segment === step
}
