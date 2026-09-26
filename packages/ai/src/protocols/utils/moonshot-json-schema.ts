import type { JsonSchema } from "../../schema/index.js"
import { isRecord } from "../../utils/record.js"

// Moonshot accepts more JSON Schema than it enforces. Keep unsupported constructs when there is no
// equivalent in its subset, rather than silently changing their meaning on other Kimi hosts.
const SCHEMA_MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
])
const VALUES = new Set(["const", "default", "enum", "example", "examples", "required", "dependentRequired"])
const ANNOTATIONS = new Set([
  "description",
  "title",
  "default",
  "example",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$comment",
])
const TYPES = new Set(["null", "boolean", "object", "array", "number", "integer", "string"])
const NULLABLE_ENUM_TYPES = new Set(["string", "number", "integer", "boolean"])
const RESERVED_PROPERTIES = new Set(["$defs", "$ref", "anyOf", "required", "additionalProperties"])

const mapValues = (record: Record<string, unknown>, map: (value: unknown, key: string) => unknown) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value, key)]))

const omit = (record: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))

const jsonType = (value: unknown) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value)

// Walle permits references at the root, in properties, definitions, items, additionalProperties,
// and anyOf. An allOf wrapper can only be unwrapped where its resulting $ref is legal.
const node = (value: unknown, root: JsonSchema, allowRef: boolean): unknown => {
  if (!isRecord(value)) return value
  const normalized = mapValues(value, (child, key) => {
    if (VALUES.has(key)) return child
    if (SCHEMA_MAPS.has(key) && isRecord(child))
      return mapValues(child, (entry) => {
        // Walle rejects a referenced definition containing only annotations as non-terminating.
        // A union of the six JSON types means exactly the same thing as no type restriction.
        const definition =
          key === "$defs" &&
          isRecord(entry) &&
          Object.keys(entry).length > 0 &&
          Object.keys(entry).every((name) => ANNOTATIONS.has(name))
            ? { ...entry, type: ["null", "boolean", "object", "array", "number", "string"] }
            : entry
        return schemaNode(definition, root, key === "properties" || key === "$defs")
      })
    if (key === "items" || key === "prefixItems")
      return Array.isArray(child)
        ? child.map((entry) => schemaNode(entry, root, key === "items"))
        : schemaNode(child, root, true)
    if (key === "anyOf" || key === "oneOf")
      return Array.isArray(child)
        ? child.map((entry) => schemaNode(entry, root, key === "anyOf")).filter((entry) => entry !== false)
        : child
    if (key === "allOf" || key === "not")
      return Array.isArray(child) ? child.map((entry) => node(entry, root, false)) : node(child, root, false)
    if (key === "additionalProperties") return typeof child === "boolean" ? child : schemaNode(child, root, true)
    return child
  })

  const unwrapped = mergeObjects(unwrapRef(normalized, allowRef))
  const constant = "const" in unwrapped ? unwrapped.const : undefined
  const literal =
    "const" in unwrapped && !("enum" in unwrapped) && !hasUnionTarget(unwrapped, root)
      ? { ...omit(unwrapped, "const"), enum: [unwrapped.const] }
      : "const" in unwrapped &&
          Array.isArray(unwrapped.enum) &&
          (constant === null || ["string", "number", "boolean"].includes(typeof constant)) &&
          unwrapped.enum.some((item) => item === constant)
        ? { ...omit(unwrapped, "const"), enum: [constant] }
        : unwrapped
  const union = taggedUnion(literal, root)
  const tuple = tupleItems(union)
  const typed = enumType(tuple, root)
  const split = typeList(typed)
  return spreadRef(integerBounds(split), root)
}

const schemaNode = (value: unknown, root: JsonSchema, allowRef: boolean) =>
  value === true ? {} : node(value, root, allowRef)

// This is the Pydantic/Zod draft-7 shape for a described reference. Other allOf intersections
// must not be merged: properties and additionalProperties interact across branches.
const unwrapRef = (schema: Record<string, unknown>, allowRef: boolean) => {
  if (!allowRef || !Array.isArray(schema.allOf) || schema.allOf.length !== 1) return schema
  const entry = schema.allOf[0]
  if (!isRecord(entry) || typeof entry.$ref !== "string" || Object.keys(entry).length !== 1) return schema
  if (Object.keys(schema).some((key) => key !== "allOf" && !ANNOTATIONS.has(key))) return schema
  return { ...omit(schema, "allOf"), $ref: entry.$ref }
}

// Intersections of independently declared object properties can be flattened as long as no branch
// closes the object or redeclares a property. Other allOf compositions remain unchanged.
const mergeObjects = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (!Array.isArray(schema.allOf) || schema.allOf.length < 2) return schema
  if (Object.keys(schema).some((key) => key !== "allOf" && !ANNOTATIONS.has(key))) return schema
  const branches = schema.allOf
  if (
    branches.some(
      (branch) =>
        !isRecord(branch) ||
        branch.type !== "object" ||
        !isRecord(branch.properties) ||
        Object.entries(branch.properties).some(([name, value]) => RESERVED_PROPERTIES.has(name) || !isRecord(value)) ||
        ("required" in branch &&
          (!Array.isArray(branch.required) || branch.required.some((name) => typeof name !== "string"))) ||
        Object.keys(branch).some((key) => !["type", "properties", "required"].includes(key)),
    )
  )
    return schema
  const properties = Object.fromEntries(branches.flatMap((branch) => Object.entries(branch.properties)))
  if (
    Object.keys(properties).length !== branches.reduce((sum, branch) => sum + Object.keys(branch.properties).length, 0)
  )
    return schema
  return {
    ...omit(schema, "allOf"),
    type: "object",
    properties,
    ...(branches.some((branch) => "required" in branch)
      ? {
          required: [...new Set(branches.flatMap((branch) => (Array.isArray(branch.required) ? branch.required : [])))],
        }
      : {}),
  }
}

// A discriminator makes the alternatives exclusive, so oneOf and anyOf accept exactly the same
// instances. Preserve oneOf when exclusivity cannot be proven.
const taggedUnion = (schema: Record<string, unknown>, root: JsonSchema) => {
  if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2 || "anyOf" in schema) return schema
  const branches = schema.oneOf.map((branch) => {
    if (!isRecord(branch)) return undefined
    if (typeof branch.$ref !== "string") return branch
    return resolve(branch.$ref, root)
  })
  if (
    branches.some(
      (branch) =>
        !branch ||
        branch.type !== "object" ||
        !isRecord(branch.properties) ||
        Object.entries(branch.properties).some(([name, value]) => RESERVED_PROPERTIES.has(name) || !isRecord(value)),
    )
  )
    return schema
  const first = branches[0]
  if (!first || !isRecord(first.properties)) return schema
  const tag = Object.keys(first.properties).find((name) => {
    const values = branches.map((branch) => {
      if (!branch || !isRecord(branch.properties) || !Array.isArray(branch.required) || !branch.required.includes(name))
        return []
      const property = branch.properties[name]
      if (!isRecord(property)) return []
      return Array.isArray(property.enum) ? property.enum : "const" in property ? [property.const] : []
    })
    return (
      values.every(
        (items) =>
          items.length > 0 &&
          items.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item)),
      ) &&
      new Set(values.flat().map((item) => JSON.stringify(item))).size ===
        values.reduce((sum, items) => sum + items.length, 0)
    )
  })
  if (!tag) return schema
  return { ...omit(schema, "oneOf"), anyOf: schema.oneOf.map((branch) => schemaNode(branch, root, true)) }
}

// Distributing a reference across anyOf avoids Walle's type/anyOf conflict only when the
// referenced schema declares a type rather than another union.
const spreadRef = (schema: Record<string, unknown>, root: JsonSchema) => {
  if (typeof schema.$ref !== "string" || !Array.isArray(schema.anyOf)) return schema
  const target = resolve(schema.$ref, root)
  if (!target || !("type" in target) || Array.isArray(target.anyOf) || Array.isArray(target.oneOf)) return schema
  if (schema.anyOf.some((branch) => !isRecord(branch) || "$ref" in branch || "anyOf" in branch)) return schema
  return { ...omit(schema, "$ref"), anyOf: schema.anyOf.map((branch) => ({ $ref: schema.$ref, ...branch })) }
}

// Moonshot has one `items` schema for all array entries. For open tuples, later entries may be
// anything; for closed tuples, maxItems retains their length constraint.
const tupleItems = (schema: Record<string, unknown>) => {
  const prefix = Array.isArray(schema.prefixItems)
    ? schema.prefixItems
    : Array.isArray(schema.items)
      ? schema.items
      : undefined
  if (!prefix) {
    if (schema.items === false) return { ...omit(schema, "items"), maxItems: 0 }
    return schema
  }
  const modern = Array.isArray(schema.prefixItems)
  const rest = modern ? schema.items : schema.additionalItems
  const blocked = prefix.indexOf(false)
  const closed = rest === false || blocked >= 0
  const limit = blocked >= 0 ? blocked : prefix.length
  const maximum =
    closed || blocked >= 0 ? Math.min(typeof schema.maxItems === "number" ? schema.maxItems : limit, limit) : undefined
  const entries = prefix.slice(0, limit)
  if (modern && "unevaluatedItems" in schema && rest === undefined) return schema
  const items =
    !closed && (rest === undefined || rest === true)
      ? {}
      : entries.length === 0
        ? {}
        : entries.length === 1 && !isRecord(rest)
          ? entries[0]
          : { anyOf: [...entries, ...(isRecord(rest) ? [rest] : [])] }
  return {
    ...omit(schema, "items", "additionalItems"),
    ...(maximum === undefined ? {} : { maxItems: maximum }),
    ...(maximum === 0 ? {} : { items }),
  }
}

// An untyped enum is rejected by Moonshot. A multi-type enum is only allowed for one primitive
// plus null; split other combinations without admitting values excluded by an explicit type list.
const enumType = (schema: Record<string, unknown>, root: JsonSchema) => {
  if (!Array.isArray(schema.enum) || schema.enum.length === 0 || typeof schema.type === "string") return schema
  const declared = Array.isArray(schema.type) ? schema.type : undefined
  if (declared?.some((type) => !TYPES.has(type))) return schema
  if (declared?.length === 1) return { ...schema, type: declared[0] }
  if (declared?.length === 2 && declared.includes("null") && declared.some((type) => NULLABLE_ENUM_TYPES.has(type)))
    return schema
  if (hasUnionTarget(schema, root)) return schema
  const values = declared
    ? schema.enum.filter((value) =>
        declared.some(
          (type) =>
            type === jsonType(value) || (type === "integer" && typeof value === "number" && Number.isInteger(value)),
        ),
      )
    : schema.enum
  if (values.length === 0) return schema
  const types = [
    ...new Set(
      values.map((value) => {
        if (declared?.includes("integer") && typeof value === "number" && Number.isInteger(value)) return "integer"
        return jsonType(value)
      }),
    ),
  ]
  if (types.length === 1) return { ...schema, enum: values, type: types[0] }
  if (types.length === 2 && types.includes("null") && types.some((type) => NULLABLE_ENUM_TYPES.has(type)))
    return { ...schema, enum: values, type: [types.find((type) => type !== "null"), "null"] }
  if (Array.isArray(schema.anyOf)) {
    if (
      schema.anyOf.some(
        (branch) => !isRecord(branch) || typeof branch.type !== "string" || "$ref" in branch || "anyOf" in branch,
      )
    )
      return schema
    const branches = schema.anyOf.flatMap((branch) => {
      const matches = values.filter(
        (value) =>
          (branch.type === jsonType(value) ||
            (branch.type === "integer" && typeof value === "number" && Number.isInteger(value))) &&
          (!Array.isArray(branch.enum) || branch.enum.includes(value)),
      )
      return matches.length > 0 ? [{ ...branch, enum: matches }] : []
    })
    return branches.length === 0 ? schema : { ...omit(schema, "type", "enum"), anyOf: branches }
  }
  return {
    ...omit(schema, "type", "enum"),
    anyOf: types.map((type) =>
      type === "null"
        ? { type }
        : { type, enum: values.filter((value) => jsonType(value) === (type === "integer" ? "number" : type)) },
    ),
  }
}

// Walle discards constraints beside type arrays, including optional-object properties and string
// lengths. Move them into each type branch; Walle drops inapplicable keywords within each branch.
const typeList = (schema: Record<string, unknown>) => {
  if (!Array.isArray(schema.type) || schema.type.length < 2 || "anyOf" in schema || "$ref" in schema) return schema
  if (schema.type.some((type) => !TYPES.has(type))) return schema
  const constraints = omit(schema, "type", "$defs", "$id", "description", "title", "default")
  if (Object.keys(constraints).length === 0 && !("default" in schema)) return schema
  if (Object.keys(constraints).length === 1 && "enum" in constraints && !("default" in schema)) return schema
  // Walle accepts a null bound on a type list but rejects it on its individual branches.
  if (["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum"].some((key) => constraints[key] === null))
    return schema
  const branches = schema.type.flatMap((type) => {
    if (!Array.isArray(constraints.enum)) return [integerBounds({ type, ...constraints })]
    const values = constraints.enum.filter(
      (value) =>
        type === jsonType(value) || (type === "integer" && typeof value === "number" && Number.isInteger(value)),
    )
    return values.length > 0 ? [integerBounds({ type, ...constraints, enum: values })] : []
  })
  if (branches.length === 0) return schema
  return {
    ...omit(schema, "type", ...Object.keys(constraints)),
    anyOf: branches,
  }
}

// The numeric exclusive bounds are ignored by Moonshot. For integers, their inclusive equivalent
// is exact, including non-integer bounds.
const integerBounds = (schema: Record<string, unknown>) => {
  if (schema.type !== "integer") return schema
  const lower =
    typeof schema.exclusiveMinimum === "number"
      ? Math.floor(schema.exclusiveMinimum) + 1
      : schema.exclusiveMinimum === true && typeof schema.minimum === "number"
        ? Math.floor(schema.minimum) + 1
        : undefined
  const upper =
    typeof schema.exclusiveMaximum === "number"
      ? Math.ceil(schema.exclusiveMaximum) - 1
      : schema.exclusiveMaximum === true && typeof schema.maximum === "number"
        ? Math.ceil(schema.maximum) - 1
        : undefined
  if (lower === undefined && upper === undefined) return schema
  return {
    ...omit(schema, "exclusiveMinimum", "exclusiveMaximum"),
    ...(lower === undefined
      ? {}
      : { minimum: typeof schema.minimum === "number" ? Math.max(schema.minimum, lower) : lower }),
    ...(upper === undefined
      ? {}
      : { maximum: typeof schema.maximum === "number" ? Math.min(schema.maximum, upper) : upper }),
  }
}

const resolve = (ref: string, root: JsonSchema): Record<string, unknown> | undefined => {
  const seen = new Set<string>()
  const follow = (pointer: string): Record<string, unknown> | undefined => {
    if (seen.has(pointer) || !pointer.startsWith("#")) return undefined
    seen.add(pointer)
    const target =
      pointer === "#"
        ? root
        : pointer.startsWith("#/")
          ? pointer
              .slice(2)
              .split("/")
              .reduce<unknown>(
                (current, key) =>
                  isRecord(current) ? current[key.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined,
                root,
              )
          : undefined
    if (!isRecord(target)) return undefined
    return typeof target.$ref === "string" ? follow(target.$ref) : target
  }
  return follow(ref)
}

const hasUnionTarget = (schema: Record<string, unknown>, root: JsonSchema) => {
  if (typeof schema.$ref !== "string") return false
  const target = resolve(schema.$ref, root)
  return !!target && (Array.isArray(target.anyOf) || Array.isArray(target.oneOf))
}

export const normalize = (schema: JsonSchema): JsonSchema => {
  const normalized = node(schema, schema, true)
  return isRecord(normalized) ? normalized : {}
}

export * as MoonshotJsonSchema from "./moonshot-json-schema.js"
