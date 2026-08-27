export * as ToolInputRepairPlugin from "./tool-input-repair.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import type { ToolDraft } from "@opencode-ai/plugin/effect/tool"
import { CodeMode } from "@opencode-ai/codemode"
import { Effect, JsonSchema, Option, Predicate, Schema } from "effect"
import { definition } from "../tool/runtime.js"

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

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const maxDepth = 6
const executeSchema = Schema.toJsonSchemaDocument(CodeMode.Input).schema

export const Plugin = define({
  id: "opencode.tool.input.repair",
  effect: Effect.fn(function* (ctx) {
    let get: ToolDraft["get"] = () => undefined
    yield* ctx.tool.transform((draft) => {
      // The draft sees later tool transforms too; reload replaces this lookup.
      get = draft.get
    })
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.sync(() => {
        const tool = get(event.tool)
        // The outer Code Mode tool is synthesized by snapshots, not registered in the draft.
        const schema = tool ? definition(tool).inputSchema : event.tool === "execute" ? executeSchema : undefined
        if (schema?.type !== "object") return
        event.input = repair(event.input, schema, schema, 0)
      }),
    )
  }),
})

function repair(value: unknown, schema: JsonSchema.JsonSchema, root: JsonSchema.JsonSchema, depth: number): unknown {
  if (depth > maxDepth) return value

  if (typeof schema.$ref === "string") {
    const definitions = /^#\/\$defs\/[^/]+$/.test(schema.$ref)
      ? root.$defs
      : /^#\/definitions\/[^/]+$/.test(schema.$ref)
        ? root.definitions
        : undefined
    if (!Predicate.isObject(definitions)) return value
    const target = JsonSchema.resolve$ref(
      schema.$ref,
      Object.fromEntries(
        Object.entries(definitions).filter((entry): entry is [string, JsonSchema.JsonSchema] =>
          Predicate.isObject(entry[1]),
        ),
      ),
    )
    return target ? repair(value, target, root, depth + 1) : value
  }

  if (Array.isArray(schema.type)) {
    if (value === null && schema.type.includes("null")) return value
    if (schema.type.includes(typeof value)) return value
    const types = schema.type.filter((type) => type !== "null")
    return types.length === 1 ? repair(value, { ...schema, type: types[0] }, root, depth + 1) : value
  }

  if (schema.type === undefined) {
    if (Array.isArray(schema.anyOf) && Array.isArray(schema.oneOf)) return value
    const branches = Array.isArray(schema.anyOf) ? schema.anyOf : schema.oneOf
    if (!Array.isArray(branches) || value === null) return value
    if (branches.some((branch) => !Predicate.isObject(branch) || branch.type === typeof value)) return value
    const candidates = branches.filter((branch) => Predicate.isObject(branch) && branch.type !== "null")
    return candidates.length === 1 ? repair(value, candidates[0], root, depth + 1) : value
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

  return Object.keys(parsed).reduce<Record<string, unknown>>((result, key) => {
    const current = result[key]
    const declared = Object.hasOwn(properties, key)
    const property = declared ? properties[key] : !patterned ? schema.additionalProperties : undefined

    if (!declared && schema.additionalProperties === false && !patterned && !composed) {
      const next = { ...result }
      delete next[key]
      return next
    }
    if (!Predicate.isObject(property)) return result

    if (declared && !required.includes(key)) {
      const branches = Array.isArray(property.anyOf)
        ? property.anyOf
        : Array.isArray(property.oneOf)
          ? property.oneOf
          : []
      const nullable =
        property.nullable === true ||
        property.type === "null" ||
        (Array.isArray(property.type) && property.type.includes("null")) ||
        branches.some(
          (branch) =>
            branch === true ||
            (Predicate.isObject(branch) &&
              (branch.type === "null" || branch.const === null || typeof branch.$ref === "string")),
        )
      const placeholder =
        Predicate.isObject(current) &&
        Object.keys(current).length === 0 &&
        typeof property.type === "string" &&
        property.type !== "object" &&
        branches.length === 0
      if ((current === null && !nullable && (property.type !== undefined || branches.length > 0)) || placeholder) {
        const next = { ...result }
        delete next[key]
        return next
      }
    }

    const repaired = repair(current, property, root, depth + 1)
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
      return Predicate.isObject(member) ? repair(item, member, root, depth + 1) : item
    })
    return repaired.every((item, index) => item === parsed[index]) ? parsed : repaired
  }

  if (tuple || !Predicate.isObject(schema.items)) return value
  const repaired = repair(value, schema.items, root, depth + 1)
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
