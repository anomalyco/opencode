import type { JsonSchema } from "../../tool.js"
import { isRecord, nonEmptyString } from "./shared.js"
import type { Document } from "./types.js"

export const projectSchema = (value: unknown, depth = 0): JsonSchema => {
  if (depth > 24 || !isRecord(value)) return {}
  const ref = nonEmptyString(value.$ref)
  if (ref !== undefined) {
    // `#/components/schemas/X` becomes `#/$defs/X`, the only ref form the
    // signature renderer resolves. `~` is unescaped to match the `$defs` key;
    // `/` must stay escaped because the renderer takes the last `/` segment.
    const name = ref.match(/^#\/components\/schemas\/(.+)$/)?.[1]
    return { $ref: name === undefined ? ref : `#/$defs/${name.replaceAll("~0", "~")}` }
  }

  const type = Array.isArray(value.type)
    ? value.type.filter((item): item is string => typeof item === "string")
    : nonEmptyString(value.type)
  const description = nonEmptyString(value.description)
  const format = nonEmptyString(value.format)
  const projected: JsonSchema = {
    ...(type === undefined ? {} : { type }),
    ...(Array.isArray(value.enum) ? { enum: value.enum } : {}),
    ...(value.const === undefined ? {} : { const: value.const }),
    ...(Array.isArray(value.anyOf) ? { anyOf: value.anyOf.map((item) => projectSchema(item, depth + 1)) } : {}),
    ...(Array.isArray(value.oneOf) ? { oneOf: value.oneOf.map((item) => projectSchema(item, depth + 1)) } : {}),
    ...(Array.isArray(value.allOf) ? { allOf: value.allOf.map((item) => projectSchema(item, depth + 1)) } : {}),
    ...(isRecord(value.properties)
      ? {
          properties: Object.fromEntries(
            Object.entries(value.properties).map(([key, item]) => [key, projectSchema(item, depth + 1)]),
          ),
        }
      : {}),
    ...(Array.isArray(value.required)
      ? { required: value.required.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(isRecord(value.items) ? { items: projectSchema(value.items, depth + 1) } : {}),
    ...(typeof value.additionalProperties === "boolean"
      ? { additionalProperties: value.additionalProperties }
      : isRecord(value.additionalProperties)
        ? { additionalProperties: projectSchema(value.additionalProperties, depth + 1) }
        : {}),
    ...(description === undefined ? {} : { description }),
    ...(value.default === undefined ? {} : { default: value.default }),
    ...(format === undefined ? {} : { format }),
    ...(value.deprecated === true ? { deprecated: true } : {}),
    ...(typeof value.minItems === "number" ? { minItems: value.minItems } : {}),
    ...(typeof value.maxItems === "number" ? { maxItems: value.maxItems } : {}),
  }
  // OpenAPI 3.0 nullable -> union with null, matching what 3.1 expresses via type arrays.
  if (value.nullable !== true) return projected
  if (Array.isArray(projected.type)) return { ...projected, type: [...projected.type, "null"] }
  if (typeof projected.type === "string") return { ...projected, type: [projected.type, "null"] }
  return { anyOf: [projected, { type: "null" }] }
}

export const componentDefinitions = (document: Document): Readonly<Record<string, JsonSchema>> => {
  const components = isRecord(document.components) ? document.components : {}
  const schemas = isRecord(components.schemas) ? components.schemas : {}
  return Object.fromEntries(Object.entries(schemas).map(([name, value]) => [name, projectSchema(value)]))
}

export const withDefinitions = (schema: JsonSchema, definitions: Readonly<Record<string, JsonSchema>>): JsonSchema =>
  Object.keys(definitions).length === 0 ? schema : { ...schema, $defs: definitions }

export const isJsonMediaType = (mediaType: string): boolean => {
  const normalized = mediaType.split(";")[0]?.trim().toLowerCase() ?? ""
  return normalized === "application/json" || normalized.endsWith("+json")
}

export const jsonContentSchema = (content: Record<string, unknown>): unknown => {
  const entry = Object.entries(content).find(([mediaType]) => isJsonMediaType(mediaType))
  return entry !== undefined && isRecord(entry[1]) ? entry[1].schema : undefined
}
