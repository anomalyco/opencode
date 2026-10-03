import { JsonSchema, Option, Predicate, Schema } from "effect"

// Port of the v2 ToolInputRepairPlugin rules (packages/core/src/plugin/tool-input-repair.ts).
// Repairs apply only when the input schema unambiguously supports them:
// - Stringified root or nested object: '{"limit":"20"}' -> { limit: 20 }
// - Closed object: { limit: "20", extra: true } -> { limit: 20 }
// - Optional null or empty-object placeholder: { limit: null } -> {}
// - Numeric or boolean string: { limit: "20", enabled: "false" } -> { limit: 20, enabled: false }
// - Nullable field: { count: "2" } -> { count: 2 }
// - Stringified array or compatible item: { tags: '["a"]', count: "2" } -> { tags: ["a"], count: [2] }
// - Positional tuple: { pair: ["2", "false"] } -> { pair: [2, false] }
// - Typed dictionary: { counts: { first: "2" } } -> { counts: { first: 2 } }
// - Nested fields and local references: { items: [{ count: "2" }] } -> { items: [{ count: 2 }] }
// Inputs are never mutated; unchanged containers keep their identity.

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const maxDepth = 6

export function repair(input: unknown, schema: unknown) {
  if (!Predicate.isObject(schema) || schema.type !== "object") return input
  return repairValue(input, schema, schema, 0)
}

function repairValue(
  value: unknown,
  schema: JsonSchema.JsonSchema,
  root: JsonSchema.JsonSchema,
  depth: number,
): unknown {
  if (depth > maxDepth) return value

  if (typeof schema.$ref === "string") {
    const definitions = /^#\/\$defs\/[^/]+$/.test(schema.$ref)
      ? root.$defs
      : /^#\/definitions\/[^/]+$/.test(schema.$ref)
        ? root.definitions
        : undefined
    if (!Predicate.isObject(definitions)) return value
    const target = Object.fromEntries(
      Object.entries(definitions).filter((entry): entry is [string, JsonSchema.JsonSchema] =>
        Predicate.isObject(entry[1]),
      ),
    )[
      schema.$ref
        .slice(schema.$ref.lastIndexOf("/") + 1)
        .replaceAll("~1", "/")
        .replaceAll("~0", "~")
    ]
    return target ? repairValue(value, target, root, depth + 1) : value
  }

  if (Array.isArray(schema.type)) {
    if (value === null && schema.type.includes("null")) return value
    if (schema.type.includes(typeof value)) return value
    const types = schema.type.filter((type) => type !== "null")
    return types.length === 1 ? repairValue(value, { ...schema, type: types[0] }, root, depth + 1) : value
  }

  if (schema.type === undefined) {
    if (Array.isArray(schema.anyOf) && Array.isArray(schema.oneOf)) return value
    const branches = Array.isArray(schema.anyOf) ? schema.anyOf : schema.oneOf
    if (!Array.isArray(branches) || value === null) return value
    if (branches.some((branch) => !Predicate.isObject(branch) || branch.type === typeof value)) return value
    const candidates = branches.filter((branch) => Predicate.isObject(branch) && branch.type !== "null")
    return candidates.length === 1 ? repairValue(value, candidates[0], root, depth + 1) : value
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "string" || value.trim() === "") return value
    const parsed = Number(value)
    return Number.isFinite(parsed) && (schema.type !== "integer" || Number.isSafeInteger(parsed)) ? parsed : value
  }
  if (schema.type === "boolean") return value === "true" ? true : value === "false" ? false : value
  if (schema.type === "object") return repairObject(value, schema, root, depth)
  if (schema.type === "array") return repairArray(value, schema, root, depth)
  return value
}

function repairObject(
  value: unknown,
  schema: JsonSchema.JsonSchema,
  root: JsonSchema.JsonSchema,
  depth: number,
): unknown {
  const parsed = typeof value === "string" ? Option.getOrUndefined(decodeJson(value)) : value
  if (!Predicate.isObject(parsed)) return value

  const properties = Predicate.isObject(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  const patterned = Predicate.isObject(schema.patternProperties)
  const composed = Array.isArray(schema.allOf) || Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)

  return Object.keys(parsed).reduce((result, key) => {
    const current = result[key]
    const declared = Object.hasOwn(properties, key)
    const property = declared ? properties[key] : !patterned ? schema.additionalProperties : undefined

    if (!declared && schema.additionalProperties === false && !patterned && !composed) {
      const next = { ...result }
      delete next[key]
      return next
    }
    if (!Predicate.isObject(property)) return result

    // Only a bare single-type property provably rejects null and `{}`. Compositions, enums,
    // constants, references and nullable flags may accept them, so those are left alone.
    const plain =
      typeof property.type === "string" &&
      property.type !== "null" &&
      !composed &&
      ["anyOf", "oneOf", "allOf", "enum", "const", "$ref", "nullable"].every((keyword) => !(keyword in property))
    const placeholder = Predicate.isObject(current) && Object.keys(current).length === 0 && property.type !== "object"
    if (declared && !required.includes(key) && plain && (current === null || placeholder)) {
      const next = { ...result }
      delete next[key]
      return next
    }

    const repaired = repairValue(current, property, root, depth + 1)
    return repaired === current ? result : { ...result, [key]: repaired }
  }, parsed)
}

function repairArray(
  value: unknown,
  schema: JsonSchema.JsonSchema,
  root: JsonSchema.JsonSchema,
  depth: number,
): unknown {
  const parsed = typeof value === "string" ? Option.getOrUndefined(decodeJson(value)) : value
  const tuple = Array.isArray(schema.prefixItems)
    ? schema.prefixItems
    : Array.isArray(schema.items)
      ? schema.items
      : undefined

  if (Array.isArray(parsed)) {
    const repaired = parsed.map((item, index) => {
      const member = tuple
        ? (tuple[index] ?? (Array.isArray(schema.prefixItems) ? schema.items : schema.additionalItems))
        : schema.items
      return Predicate.isObject(member) ? repairValue(item, member, root, depth + 1) : item
    })
    return repaired.every((item, index) => item === parsed[index]) ? parsed : repaired
  }

  if (tuple || !Predicate.isObject(schema.items)) return value
  const repaired = repairValue(value, schema.items, root, depth + 1)
  const type = schema.items.type
  const compatible =
    type === "object"
      ? Predicate.isObject(repaired)
      : type === "array"
        ? Array.isArray(repaired)
        : type === "integer"
          ? typeof repaired === "number" && Number.isSafeInteger(repaired)
          : type === "number"
            ? typeof repaired === "number" && Number.isFinite(repaired)
            : (type === "string" || type === "boolean") && typeof repaired === type
  return compatible ? [repaired] : value
}

export * as ToolInputRepair from "./input-repair"
