export const arrayMethods = new Set([
  "map",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "includes",
  "join",
  "reduce",
  "reduceRight",
  "flatMap",
  "forEach",
  "sort",
  "toSorted",
  "slice",
  "concat",
  "indexOf",
  "lastIndexOf",
  "at",
  "flat",
  "reverse",
  "toReversed",
  "with",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "fill",
  "copyWithin",
  "keys",
  "values",
  "entries",
])

export const mapMethods = new Set(["get", "set", "has", "delete", "clear", "forEach", "keys", "values", "entries"])

export const setMethods = new Set(["add", "has", "delete", "clear", "forEach", "keys", "values", "entries"])

export const spreadItems = (value: unknown): Array<unknown> | undefined => {
  if (Array.isArray(value)) return value
  if (typeof value === "string") return Array.from(value)
  if (value instanceof SandboxMap) return Array.from(value.map.entries(), ([key, item]) => [key, item])
  if (value instanceof SandboxSet) return Array.from(value.set.values())
  if (value instanceof SandboxURLSearchParams) return Array.from(value.params.entries(), ([key, item]) => [key, item])
  return undefined
}
import { SandboxMap, SandboxSet, SandboxURLSearchParams } from "../values.js"
