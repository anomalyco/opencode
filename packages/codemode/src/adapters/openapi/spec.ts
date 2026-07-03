import type { JsonSchema } from "../../tool.js"
import type { Body, Document, Parameter, ParameterLocation, SecurityRequirement, SecurityScheme, Skip } from "./types.js"

export const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"])
const parameterLocations = new Set(["path", "query", "header"])
const ignoredHeaderParameters = new Set(["accept", "content-type", "authorization"])
const schemeTypes = new Set(["apiKey", "http", "oauth2", "openIdConnect"])
const blockedOperationNames = new Set(["__proto__", "constructor", "prototype"])
export const maxErrorBodyChars = 1_024

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])

export const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined

// Guards record lookups keyed by spec- or model-controlled names against
// prototype-inherited values (e.g. a parameter named `toString`).
export const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

export const resolve = (document: Document, value: unknown): unknown => {
  if (!isRecord(value)) return value
  const ref = nonEmptyString(value.$ref)
  if (ref === undefined || !ref.startsWith("#/")) return value
  const target = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, segment) => (isRecord(current) ? current[segment] : undefined), document)
  return target ?? value
}

const projectSchema = (value: unknown, depth = 0): JsonSchema => {
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

const withDefinitions = (schema: JsonSchema, definitions: Readonly<Record<string, JsonSchema>>): JsonSchema =>
  Object.keys(definitions).length === 0 ? schema : { ...schema, $defs: definitions }

const isJsonMediaType = (mediaType: string): boolean => {
  const normalized = mediaType.split(";")[0]?.trim().toLowerCase() ?? ""
  return normalized === "application/json" || normalized.endsWith("+json")
}

const jsonContentSchema = (content: Record<string, unknown>): unknown => {
  const entry = Object.entries(content).find(([mediaType]) => isJsonMediaType(mediaType))
  return entry !== undefined && isRecord(entry[1]) ? entry[1].schema : undefined
}

export const operationParameters = (
  document: Document,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
): ReadonlyArray<Parameter> => {
  // Operation-level parameters override path-level ones sharing (location, name).
  const merged = new Map<string, Parameter>()
  for (const raw of [...asArray(pathItem.parameters), ...asArray(operation.parameters)]) {
    const resolved = resolve(document, raw)
    if (!isRecord(resolved)) continue
    const name = nonEmptyString(resolved.name)
    const location = nonEmptyString(resolved.in)
    if (name === undefined || location === undefined || !parameterLocations.has(location)) continue
    if (location === "header" && ignoredHeaderParameters.has(name.toLowerCase())) continue
    const base = projectSchema(resolved.schema)
    const description = nonEmptyString(resolved.description)
    merged.set(`${location}:${name}`, {
      name,
      location: location as ParameterLocation,
      required: resolved.required === true || location === "path",
      schema: {
        ...base,
        ...(base.description === undefined && description !== undefined ? { description } : {}),
      },
    })
  }
  return [...merged.values()]
}

export const requestBody = (document: Document, operation: Record<string, unknown>): Body | Skip | undefined => {
  const resolved = resolve(document, operation.requestBody)
  if (!isRecord(resolved)) return undefined
  const content = isRecord(resolved.content) ? resolved.content : {}
  if (!Object.keys(content).some(isJsonMediaType)) {
    const declared = Object.keys(content).join(", ") || "none"
    return { reason: `request body has no JSON content (declared: ${declared})` }
  }
  return {
    required: resolved.required === true,
    schema: projectSchema(jsonContentSchema(content)),
  }
}

export const inputSchema = (
  parameters: ReadonlyArray<Parameter>,
  body: Body | undefined,
  definitions: Readonly<Record<string, JsonSchema>>,
): JsonSchema => {
  const groups: ReadonlyArray<{ readonly name: string; readonly location: ParameterLocation }> = [
    { name: "path", location: "path" },
    { name: "query", location: "query" },
    { name: "headers", location: "header" },
  ]
  const grouped = groups.flatMap((group) => {
    const items = parameters.filter((parameter) => parameter.location === group.location)
    if (items.length === 0) return []
    const required = items.filter((item) => item.required).map((item) => item.name)
    const schema: JsonSchema = {
      type: "object",
      properties: Object.fromEntries(items.map((item) => [item.name, item.schema])),
      ...(required.length === 0 ? {} : { required }),
    }
    return [{ name: group.name, schema, required: required.length > 0 }]
  })
  const properties = Object.fromEntries([
    ...grouped.map((group) => [group.name, group.schema] as const),
    ...(body === undefined ? [] : [["body", body.schema] as const]),
  ])
  const required = [
    ...grouped.filter((group) => group.required).map((group) => group.name),
    ...(body?.required === true ? ["body"] : []),
  ]
  return withDefinitions({ type: "object", properties, ...(required.length === 0 ? {} : { required }) }, definitions)
}

export const outputSchema = (
  document: Document,
  operation: Record<string, unknown>,
  definitions: Readonly<Record<string, JsonSchema>>,
): JsonSchema | undefined => {
  if (!isRecord(operation.responses)) return undefined
  const entries = Object.entries(operation.responses)
  const successes = [
    ...entries.filter(([status]) => /^2\d\d$/.test(status)).sort(([a], [b]) => a.localeCompare(b)),
    ...entries.filter(([status]) => status.toUpperCase() === "2XX"),
  ]
    .map(([, ref]) => resolve(document, ref))
    .filter(isRecord)
  for (const response of successes) {
    const schema = jsonContentSchema(isRecord(response.content) ? response.content : {})
    if (schema !== undefined) return withDefinitions(projectSchema(schema), definitions)
  }
  // Declared non-JSON content (e.g. text/plain) returns the raw body -> unknown.
  const declaresContent = successes.some(
    (response) => isRecord(response.content) && Object.keys(response.content).length > 0,
  )
  if (declaresContent) return undefined
  // No-content success (e.g. 204) -> null.
  return successes.length > 0 ? { type: "null" } : undefined
}

const sanitizeOperationSegment = (raw: string): string => {
  const base =
    raw
      .replaceAll(/[^A-Za-z0-9_$]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "_$1") || "operation"
  return blockedOperationNames.has(base) ? `${base}_2` : base
}

export const operationPath = (
  method: string,
  path: string,
  operation: Record<string, unknown>,
  used: ReadonlySet<string>,
  namespaces: ReadonlySet<string>,
): ReadonlyArray<string> => {
  const raw = nonEmptyString(operation.operationId)
  const base = (raw === undefined ? [`${method}_${path.replaceAll(/[{}]/g, "")}`] : raw.split("."))
    .map(sanitizeOperationSegment)
    .filter((segment) => segment !== "")
  const segments = base.length === 0 ? ["operation"] : base
  if (isOperationPathAvailable(segments, used, namespaces)) return segments
  const fallback = [segments.join("_")]
  const next = (index: number): string => {
    const candidate = `${fallback[0]}_${index}`
    return isOperationPathAvailable([candidate], used, namespaces) ? candidate : next(index + 1)
  }
  return [next(2)]
}

const isOperationPathAvailable = (
  segments: ReadonlyArray<string>,
  used: ReadonlySet<string>,
  namespaces: ReadonlySet<string>,
): boolean => {
  const key = segments.join(".")
  if (used.has(key) || namespaces.has(key)) return false
  return segments.slice(0, -1).every((_, index) => !used.has(segments.slice(0, index + 1).join(".")))
}

export const specServerUrl = (document: Document): string | Skip => {
  const server = asArray(document.servers).find(isRecord)
  const url = server === undefined ? undefined : nonEmptyString(server.url)
  if (url === undefined) return { reason: "spec declares no servers; pass baseUrl" }
  // Templated or relative server URLs cannot be resolved by the adapter.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /\{[^{}]+\}/.test(url)) {
    return { reason: `server URL '${url}' is not an absolute URL; pass baseUrl` }
  }
  return url
}

export const securityRequirements = (value: unknown): ReadonlyArray<SecurityRequirement> =>
  asArray(value)
    .filter(isRecord)
    .map((requirement) =>
      Object.fromEntries(
        Object.entries(requirement).map(([name, scopes]) => [
          name,
          asArray(scopes).filter((scope): scope is string => typeof scope === "string"),
        ]),
      ),
    )

export const securitySchemes = (document: Document): Readonly<Record<string, SecurityScheme>> => {
  const components = isRecord(document.components) ? document.components : {}
  const declared = isRecord(components.securitySchemes) ? components.securitySchemes : {}
  return Object.fromEntries(
    Object.entries(declared).flatMap(([name, value]) => {
      const resolved = resolve(document, value)
      if (!isRecord(resolved)) return []
      const type = nonEmptyString(resolved.type)
      if (type === undefined || !schemeTypes.has(type)) return []
      const carrier = nonEmptyString(resolved.in)
      return [
        [
          name,
          {
            name,
            type: type as SecurityScheme["type"],
            in: carrier === "header" || carrier === "query" || carrier === "cookie" ? carrier : undefined,
            parameterName: nonEmptyString(resolved.name),
            scheme: nonEmptyString(resolved.scheme)?.toLowerCase(),
          },
        ] as const,
      ]
    }),
  )
}
