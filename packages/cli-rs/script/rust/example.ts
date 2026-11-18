// A sample value of a schema representation, for the operations' table-driven test (`typed-client`): every field set
// where the depth allows, so a request built from it exercises the path, the query's brackets and the body, and the
// first member of a union. Not a fuzzer: one value per type, the same on every run.
import type { SchemaRepresentation } from "effect"
import type { Types } from "./types.ts"

type R = SchemaRepresentation.Representation

/** Below this depth an object sets its optional fields too, unless it would otherwise be empty. */
const OPTIONAL_DEPTH = 4
/** Past this depth a value is `undefined`, which leaves an optional field out, so a recursive type ends. */
const MAX_DEPTH = 8

export function example(types: Types, r: R, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined
  const resolved = types.deref(r)
  switch (resolved._tag) {
    case "String":
    case "TemplateLiteral":
      return `s${depth}`
    case "Enum":
      return resolved.enums[0]?.[1]
    case "Number":
      return integer(resolved) ? 2 : 1.5
    case "Boolean":
      return true
    case "Literal":
      return resolved.literal
    case "Null":
      return null
    case "Undefined":
    case "Void":
    case "Never":
      return undefined
    case "Arrays": {
      const elements = resolved.elements.map((element) => example(types, element.type, depth + 1))
      const rest = resolved.rest[0] === undefined ? [] : [example(types, resolved.rest[0], depth + 1)]
      return [...elements, ...rest].filter((value) => value !== undefined)
    }
    case "Union": {
      const members = resolved.types.filter((member) => !["Null", "Undefined"].includes(types.deref(member)._tag))
      for (const member of members) {
        const value = example(types, member, depth + 1)
        if (value !== undefined) return value
      }
      return null
    }
    case "Objects": {
      const fields: Record<string, unknown> = {}
      const required = resolved.propertySignatures.filter((property) => !property.isOptional)
      const wanted = depth < OPTIONAL_DEPTH || required.length === 0 ? resolved.propertySignatures : required
      for (const property of wanted) {
        const value = example(types, property.type, depth + 1)
        if (value !== undefined && typeof property.name === "string") fields[property.name] = value
      }
      if (Object.keys(fields).length === 0 && resolved.indexSignatures[0] !== undefined) {
        const value = example(types, resolved.indexSignatures[0].type, depth + 1)
        if (value !== undefined) fields.key = value
      }
      return fields
    }
  }
  return "any"
}

/**
 * The Luau type of a path, query or header field, written in place (the Luau stub types bodies and replies from the
 * OpenAPI document, which has the encoded forms of these fields: a query's number is a string there).
 */
export function luauType(types: Types, r: R, depth = 0): string {
  if (depth > 4) return "any"
  const resolved = types.deref(r)
  switch (resolved._tag) {
    case "String":
    case "TemplateLiteral":
      return "string"
    case "Number":
      return "number"
    case "Boolean":
      return "boolean"
    case "Literal":
      return typeof resolved.literal === "string" ? JSON.stringify(resolved.literal) : typeof resolved.literal
    case "Enum":
      return union(resolved.enums.map(([, value]) => (typeof value === "string" ? JSON.stringify(value) : "number")))
    case "Arrays": {
      const items = [...resolved.elements.map((element) => element.type), ...resolved.rest]
      return `{ ${union(items.map((item) => luauType(types, item, depth + 1)))} }`
    }
    case "Union": {
      const present = resolved.types.filter((member) => !["Null", "Undefined"].includes(types.deref(member)._tag))
      const type = union(present.map((member) => luauType(types, member, depth + 1)))
      return present.length < resolved.types.length && type !== "any" && !type.endsWith("?") ? `${type}?` : type
    }
    case "Objects": {
      if (resolved.propertySignatures.length === 0) return "{ [string]: any }"
      const fields = resolved.propertySignatures.map((property) => {
        const type = luauType(types, property.type, depth + 1)
        const optional = property.isOptional && !type.endsWith("?") && type !== "any" ? "?" : ""
        const name = String(property.name)
        return `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `[${JSON.stringify(name)}]`}: ${type}${optional}`
      })
      return `{ ${fields.join(", ")} }`
    }
  }
  return "any"
}

function union(types: Array<string>) {
  const unique = [...new Set(types)]
  if (unique.includes("any")) return "any"
  return unique.length === 1 ? unique[0] : `(${unique.join(" | ")})`
}

// As `integer` in types.ts, which makes such a number an `i64`.
function integer(r: SchemaRepresentation.Number) {
  const visit = (checks: ReadonlyArray<SchemaRepresentation.Check>): boolean =>
    checks.some((check) =>
      check._tag === "Filter" ? check.representation?.id === "effect/schema/isInt" : visit(check.checks),
    )
  return visit(r.checks)
}
