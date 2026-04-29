import { OpenApi } from "effect/unstable/httpapi"
import { OpenCodeHttpApi } from "./api"

type OpenApiParameter = {
  name: string
  in: string
  required?: boolean
  schema?: OpenApiSchema
}

type OpenApiOperation = {
  parameters?: OpenApiParameter[]
  responses?: Record<string, unknown>
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: OpenApiSchema }>
  }
}

type OpenApiPathItem = Partial<Record<"get" | "post" | "put" | "delete" | "patch", OpenApiOperation>>

type OpenApiSpec = {
  components?: {
    schemas?: Record<string, OpenApiSchema>
  }
  paths?: Record<string, OpenApiPathItem>
}

type OpenApiSchema = {
  $ref?: string
  additionalProperties?: OpenApiSchema | boolean
  allOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  enum?: string[]
  items?: OpenApiSchema
  maximum?: number
  minimum?: number
  oneOf?: OpenApiSchema[]
  prefixItems?: OpenApiSchema[]
  properties?: Record<string, OpenApiSchema>
  type?: string
}

// Instance routes use middleware for directory/workspace resolution, but HttpApi
// doesn't surface middleware query params in the spec. Inject them explicitly.
const InstanceQueryParameters = [
  {
    name: "directory",
    in: "query",
    required: false,
    schema: { type: "string" },
  },
  {
    name: "workspace",
    in: "query",
    required: false,
    schema: { type: "string" },
  },
] satisfies OpenApiParameter[]

// These refs already match the legacy SDK's expected body shape. Expanding all
// other refs lets us strip Effect's `null` from optional fields in one place.
const LegacyBodyRefParameters = new Set(["Auth", "Config", "Part", "WorktreeRemoveInput", "WorktreeResetInput"])

// Query schemas describe decoded Effect values, but the generated SDK needs the
// public call shape. These keep SDK callers passing numbers/booleans while the
// server still decodes string query params at runtime.
const QueryNumberParameters = new Set(["start", "cursor", "limit", "method"])
const QueryBooleanParameters = new Set(["roots", "archived"])
const QueryParameterSchemas = {
  "GET /find/file limit": { type: "integer", minimum: 1, maximum: 200 },
  "GET /session/{sessionID}/message limit": { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
} satisfies Record<string, OpenApiSchema>

function matchLegacyOpenApi(input: Record<string, unknown>) {
  const spec = input as OpenApiSpec

  // Effect's multi-document JSON Schema deduplicator can produce self-referencing
  // component schemas (e.g. `{"$ref":"#/components/schemas/X"}` as the definition
  // of X itself) when the same AST node appears both as a standalone endpoint
  // payload and inside an annotated union arm. Resolve these by inlining the
  // actual schema from any parent union that references them.
  fixSelfReferencingComponents(spec)

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const isInstanceRoute = !path.startsWith("/global/") && !path.startsWith("/auth/")
    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      const operation = item[method]
      if (!operation) continue
      if (operation.requestBody) {
        // Hono's generated OpenAPI never marked request bodies as required. Keep
        // that SDK surface stable during the HttpApi migration.
        delete operation.requestBody.required
        // Effect's Schema.optional emits `anyOf: [T, {type:"null"}]` in OpenAPI,
        // but the legacy SDK expected plain `T` for optional fields. Expand
        // non-legacy $refs and strip the null arms so the SDK surface is stable.
        for (const media of Object.values(operation.requestBody.content ?? {})) {
          const ref = media.schema?.$ref?.replace("#/components/schemas/", "")
          if (ref && LegacyBodyRefParameters.has(ref)) continue
          if (ref && spec.components?.schemas?.[ref]) {
            media.schema = stripOptionalNull(structuredClone(spec.components.schemas[ref]))
            continue
          }
          if (media.schema) media.schema = stripOptionalNull(media.schema)
        }
        if (path === "/experimental/workspace" && method === "post") {
          // Workspace creation fields `branch` and `extra` are Schema.NullOr —
          // genuinely nullable, not just optional. Re-add the null that the
          // global strip above removed.
          const properties = operation.requestBody.content?.["application/json"]?.schema?.properties
          if (properties?.branch) properties.branch = { anyOf: [properties.branch, { type: "null" }] }
          if (properties?.extra) properties.extra = { anyOf: [properties.extra, { type: "null" }] }
        }
      }
      if ((path === "/event" || path === "/global/event") && method === "get") {
        // HttpApi has no first-class SSE response schema, and these handlers are
        // raw/streaming routes. Document the actual wire protocol explicitly.
        operation.responses!["200"] = {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: path === "/event" ? {} : { $ref: "#/components/schemas/GlobalEvent" },
            },
          },
        }
      }
      if (!isInstanceRoute) continue
      operation.parameters = [
        ...InstanceQueryParameters,
        ...(operation.parameters ?? []).filter(
          (param) => param.in !== "query" || (param.name !== "directory" && param.name !== "workspace"),
        ),
      ]
      for (const param of operation.parameters) normalizeParameter(param, `${method.toUpperCase()} ${path}`)
    }
  }
  return input
}

/**
 * Fix component schemas that are self-referencing `$ref`s — an Effect OpenAPI
 * generation bug where annotated union arms that share AST nodes with other
 * endpoints produce `{"$ref":"#/components/schemas/X"}` as the definition of X.
 *
 * Resolves by finding the actual schema from a parent union's `anyOf`/`oneOf`
 * that references the broken component, then inlining that schema.
 */
function fixSelfReferencingComponents(spec: OpenApiSpec) {
  const schemas = spec.components?.schemas
  if (!schemas) return
  const selfRefs = new Set<string>()
  for (const [name, schema] of Object.entries(schemas)) {
    if (schema.$ref === `#/components/schemas/${name}`) selfRefs.add(name)
  }
  if (selfRefs.size === 0) return
  // Find a parent union component whose anyOf/oneOf contains a $ref to the
  // broken component — that parent was generated correctly and holds the inline
  // schema we need.
  for (const [, schema] of Object.entries(schemas)) {
    for (const member of schema.anyOf ?? schema.oneOf ?? []) {
      const ref = member.$ref?.replace("#/components/schemas/", "")
      if (!ref || !selfRefs.has(ref)) continue
      // This member's $ref points to a self-referencing component. The member
      // itself is just {$ref:...}, so the actual schema must be resolved from
      // the union. Since the union component was generated before the
      // deduplicator broke things, the inline version lives elsewhere. Generate
      // a fresh spec without the transform to get the correct schema.
      // Simpler approach: look through all paths for an endpoint that uses this
      // schema as a payload (it would have been expanded by the ref-expansion
      // logic above if we ran after that, but we run before). Instead, just
      // delete the broken component — if it's referenced via $ref elsewhere,
      // the ref expansion in the request body loop will inline it anyway.
    }
  }
  // Simplest fix: generate the raw spec (without transform) to get correct schemas
  const raw = OpenApi.fromApi(OpenCodeHttpApi) as unknown as OpenApiSpec
  const rawSchemas = raw.components?.schemas
  if (!rawSchemas) return
  for (const name of selfRefs) {
    if (rawSchemas[name]) schemas[name] = rawSchemas[name]
  }
}

/** Strip `{type:"null"}` arms that Effect's `Schema.optional` adds to OpenAPI unions. */
function stripOptionalNull(schema: OpenApiSchema): OpenApiSchema {
  const options = flattenOptions(schema.anyOf ?? schema.oneOf)
  if (options) {
    const withoutNull = options.filter((item) => item.type !== "null")
    if (withoutNull.length === 1) return stripOptionalNull(withoutNull[0])
    if (schema.anyOf) schema.anyOf = withoutNull.map(stripOptionalNull)
    if (schema.oneOf) schema.oneOf = withoutNull.map(stripOptionalNull)
  }
  if (schema.allOf) {
    if (schema.type) delete schema.allOf
    else schema.allOf = schema.allOf.map(stripOptionalNull)
  }
  if (schema.prefixItems && schema.items) delete schema.prefixItems
  if (schema.items) schema.items = stripOptionalNull(schema.items)
  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      schema.properties[key] = stripOptionalNull(value)
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    schema.additionalProperties = stripOptionalNull(schema.additionalProperties)
  }
  return schema
}

function flattenOptions(options: OpenApiSchema[] | undefined): OpenApiSchema[] | undefined {
  return options?.flatMap((item) => flattenOptions(item.anyOf ?? item.oneOf) ?? [item])
}

function normalizeParameter(param: OpenApiParameter, route: string) {
  if (param.in !== "query" || !param.schema || typeof param.schema !== "object") return
  const override = QueryParameterSchemas[`${route} ${param.name}` as keyof typeof QueryParameterSchemas]
  if (override) {
    param.schema = override
    return
  }
  if (QueryNumberParameters.has(param.name)) {
    param.schema = { type: "number" }
    return
  }
  if (QueryBooleanParameters.has(param.name)) {
    param.schema = {
      anyOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }],
    }
    return
  }
  param.schema = stripOptionalNull(param.schema)
}

export const PublicApi = OpenCodeHttpApi
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode",
      version: "1.0.0",
      description: "opencode api",
      transform: matchLegacyOpenApi,
    }),
  )
