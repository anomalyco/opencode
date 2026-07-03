import type { JsonSchema } from "../../tool.js"
import {
  asArray,
  blockedOperationNames,
  ignoredHeaderParameters,
  isRecord,
  nonEmptyString,
  parameterLocations,
  schemeTypes,
} from "./shared.js"
import { isJsonMediaType, jsonContentSchema, projectSchema, withDefinitions } from "./schema.js"
import type { Body, Document, Parameter, ParameterLocation, SecurityRequirement, SecurityScheme, Skip } from "./types.js"

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

export const operationName = (
  method: string,
  path: string,
  operation: Record<string, unknown>,
  used: ReadonlySet<string>,
): string => {
  const raw = nonEmptyString(operation.operationId) ?? `${method}_${path.replaceAll(/[{}]/g, "")}`
  const base =
    raw
      .replaceAll(/[^A-Za-z0-9_$]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "_$1") || "operation"
  if (!used.has(base) && !blockedOperationNames.has(base)) return base
  const next = (index: number): string => {
    const candidate = `${base}_${index}`
    return used.has(candidate) || blockedOperationNames.has(candidate) ? next(index + 1) : candidate
  }
  return next(2)
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
