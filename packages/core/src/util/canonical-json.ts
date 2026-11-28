import type { Schema } from "effect"

export function canonicalJson(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

/** Recursively sorts object keys (omitting `undefined` entries) while preserving array order. */
export function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonicalize) as T
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    ) as T
  return value
}
