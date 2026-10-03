const schemaMaps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"])
const schemas = new Set([
  "items",
  "prefixItems",
  "additionalItems",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contains",
  "propertyNames",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
])
const annotations = new Set([
  "description",
  "title",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$comment",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Inline finite local references without changing the schema used to validate tool arguments. */
export function inlineSchemaReferences(schema: Record<string, unknown>): Record<string, unknown> {
  const unsupported = Symbol()
  let nodes = 0
  const visit = (value: unknown, seen: Set<string>, depth: number): unknown => {
    if (++nodes > 1024 || depth > 64) throw unsupported
    if (Array.isArray(value)) return value.map((item) => visit(item, seen, depth + 1))
    if (!isRecord(value)) return value
    if (["$id", "id", "$anchor", "$dynamicRef", "$recursiveRef"].some((key) => key in value)) throw unsupported
    if (typeof value.$ref === "string") {
      const ref = value.$ref
      if (!ref.startsWith("#/") || seen.has(ref)) throw unsupported
      // Validation siblings have draft-dependent semantics. Leave these schemas unchanged.
      if (Object.keys(value).some((key) => key !== "$ref" && !annotations.has(key))) throw unsupported
      let target: unknown = schema
      for (const part of decodeURIComponent(ref.slice(2)).split("/")) {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~")
        if (!isRecord(target) || !Object.hasOwn(target, key)) throw unsupported
        target = target[key]
      }
      if (!isRecord(target) && typeof target !== "boolean") throw unsupported
      const expanded = visit(target, new Set(seen).add(ref), depth + 1)
      if (!isRecord(expanded)) return expanded
      return { ...expanded, ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref")) }
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (schemaMaps.has(key) && isRecord(item)) {
          return [
            key,
            Object.fromEntries(Object.entries(item).map(([name, child]) => [name, visit(child, seen, depth + 1)])),
          ]
        }
        return [key, schemas.has(key) ? visit(item, seen, depth + 1) : item]
      }),
    )
  }
  try {
    const expanded = visit(schema, new Set(), 0)
    return isRecord(expanded) ? expanded : schema
  } catch (error) {
    // Keep recursive, scoped, unresolved, or excessively expanding schemas intact.
    if (error === unsupported || error instanceof URIError) return schema
    throw error
  }
}
