// Writes a generated recording compactly but still as JSON: the top level's keys on lines of their own (and those of
// an object directly under it), and each entry of an array under them as one minified line, so a change to one
// recorded program is a one-line diff.

import { writeFileSync } from "node:fs"

export const writeRecording = (path: string, value: unknown) => writeFileSync(path, format(value, 0, "") + "\n")

const format = (value: unknown, depth: number, indent: string): string => {
  const inner = indent + "  "
  if (Array.isArray(value) && depth > 0 && value.length > 0)
    return `[\n${value.map((entry) => inner + (JSON.stringify(entry) ?? "null")).join(",\n")}\n${indent}]`
  if (depth < 2 && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value).filter((entry) => entry[1] !== undefined)
    if (entries.length > 0)
      return `{\n${entries.map(([key, v]) => `${inner}${JSON.stringify(key)}: ${format(v, depth + 1, inner)}`).join(",\n")}\n${indent}}`
  }
  return JSON.stringify(value)
}
