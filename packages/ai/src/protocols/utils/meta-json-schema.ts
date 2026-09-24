import type { JsonSchema } from "../../schema/index.js"
import { isRecord } from "../../utils/record.js"

// Meta rejects tool schemas nested more than 10 levels deep and any recursive `$ref`. It adds a
// level for every `properties` or `items` key holding an object anywhere in the schema, including
// property names and values such as `default`, and follows `$ref` but ignores unreferenced `$defs`.
// Schemas within those limits are sent unchanged. Otherwise references are inlined, a recursive
// reference becomes an unconstrained schema, and structure past the limit is left unconstrained.
const MAX_DEPTH = 10
const DEFS = new Set(["$defs", "definitions"])
const VALUES = new Set(["const", "default", "enum", "examples"])
// Once `properties` is removed, these would constrain the former named properties too.
const PROPERTY_RULES = new Set(["additionalProperties", "patternProperties"])
// These also see members evaluated by subschemas, which may lose their schemas at the limit.
const UNEVALUATED = new Set(["unevaluatedProperties", "unevaluatedItems"])
const ANNOTATIONS = new Set(["title", "description"])

const cost = (key: string, value: unknown) => ((key === "properties" || key === "items") && isRecord(value) ? 1 : 0)

const resolve = (root: unknown, ref: string) => {
  if (ref !== "#" && !ref.startsWith("#/")) return undefined
  return ref
    .split("/")
    .slice(1)
    .reduce<unknown>((node, token) => {
      const key = token.replaceAll("~1", "/").replaceAll("~0", "~")
      if (isRecord(node)) return node[key]
      if (Array.isArray(node)) return node[Number(key)]
      return undefined
    }, root)
}

// Nesting depth as Meta counts it. A recursive `$ref` is infinitely deep.
const depth = (root: unknown, value: unknown, refs: ReadonlyArray<string>): number => {
  if (Array.isArray(value)) return value.reduce<number>((max, item) => Math.max(max, depth(root, item, refs)), 0)
  if (!isRecord(value)) return 0
  const own = Object.entries(value).reduce<number>(
    (max, [key, child]) => (DEFS.has(key) ? max : Math.max(max, cost(key, child) + depth(root, child, refs))),
    0,
  )
  if (typeof value.$ref !== "string") return own
  if (refs.includes(value.$ref)) return Infinity
  return Math.max(own, depth(root, resolve(root, value.$ref), [...refs, value.$ref]))
}

const rewrite = (root: unknown, schema: unknown, level: number, refs: ReadonlyArray<string>): unknown => {
  if (Array.isArray(schema)) return schema.map((item) => rewrite(root, item, level, refs))
  if (!isRecord(schema)) return schema
  if (typeof schema.$ref === "string") {
    const inlined = inline(root, schema, schema.$ref, refs)
    if (inlined) return rewrite(root, inlined, level, [...refs, schema.$ref])
  }
  // At the limit a schema cannot hold `properties` or `items`, so it accepts any object or array.
  const atLimit = level >= MAX_DEPTH
  const properties = isRecord(schema.properties) ? schema.properties : undefined
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]) => {
      if (DEFS.has(key) || (atLimit && cost(key, value) > 0)) return []
      if (atLimit && (UNEVALUATED.has(key) || (properties && PROPERTY_RULES.has(key)))) return []
      if (VALUES.has(key)) return level + depth(root, value, []) > MAX_DEPTH ? [] : [[key, value]]
      if (key === "properties" && properties)
        return [
          [
            key,
            Object.fromEntries(
              Object.entries(properties).map(([name, child]) => {
                // A property named `properties` or `items` is itself a level.
                const next = level + 1 + cost(name, child)
                return [name, next > MAX_DEPTH ? true : rewrite(root, child, next, refs)]
              }),
            ),
          ],
        ]
      return [[key, rewrite(root, value, level + cost(key, value), refs)]]
    }),
  )
}

// A recursive reference becomes an unconstrained schema. Sibling keywords apply alongside the target,
// so they merge into it unless they would replace one of its constraints.
const inline = (root: unknown, schema: Record<string, unknown>, ref: string, refs: ReadonlyArray<string>) => {
  const target = refs.includes(ref) ? {} : resolve(root, ref)
  if (target === undefined) return undefined
  const base = isRecord(target) ? target : {}
  const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref"))
  if (Object.keys(siblings).some((key) => Object.hasOwn(base, key) && !ANNOTATIONS.has(key)))
    return { allOf: [base, siblings] }
  return { ...base, ...siblings }
}

export const normalize = (schema: JsonSchema): JsonSchema => {
  if (depth(schema, schema, []) <= MAX_DEPTH) return schema
  const result = rewrite(schema, schema, 0, [])
  return isRecord(result) ? result : {}
}

export * as MetaJsonSchema from "./meta-json-schema.js"
