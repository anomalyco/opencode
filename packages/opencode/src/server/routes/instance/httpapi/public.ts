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
  responses?: Record<string, OpenApiResponse>
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: OpenApiSchema }>
  }
  security?: unknown
}

type OpenApiPathItem = Partial<Record<"get" | "post" | "put" | "delete" | "patch", OpenApiOperation>>

type OpenApiSpec = {
  components?: {
    schemas?: Record<string, OpenApiSchema>
    securitySchemes?: Record<string, unknown>
  }
  paths?: Record<string, OpenApiPathItem>
}

type OpenApiSchema = {
  $ref?: string
  additionalProperties?: OpenApiSchema | boolean
  allOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  enum?: Array<string | boolean>
  items?: OpenApiSchema
  maximum?: number
  minimum?: number
  oneOf?: OpenApiSchema[]
  prefixItems?: OpenApiSchema[]
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  type?: string
}

type OpenApiResponse = {
  description?: string
  content?: Record<string, { schema?: OpenApiSchema }>
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

// Query schemas describe decoded Effect values, but the generated SDK needs the
// public call shape. These keep SDK callers passing numbers/booleans while the
// server still decodes string query params at runtime.
const QueryNumberParameters = new Set(["start", "cursor", "limit", "method"])
const QueryBooleanParameters = new Set(["roots", "archived"])
const QueryParameterSchemas = {
  "GET /find/file limit": { type: "integer", minimum: 1, maximum: 200 },
  "GET /session/{sessionID}/message limit": { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
} satisfies Record<string, OpenApiSchema>

// Mapping of "METHOD /path" to the correct 200 response description from Hono spec
const ResponseDescriptions = {
  "GET /global/health": "Health information",
  "GET /global/config": "Get global config info",
  "PATCH /global/config": "Successfully updated global config",
  "POST /global/dispose": "Global disposed",
  "POST /global/upgrade": "Upgrade result",
  "PUT /auth/{providerID}": "Successfully set authentication credentials",
  "DELETE /auth/{providerID}": "Successfully removed authentication credentials",
  "POST /log": "Log entry written successfully",
  "GET /experimental/workspace/adaptor": "Workspace adaptors",
  "POST /experimental/workspace": "Workspace created",
  "GET /experimental/workspace": "Workspaces",
  "GET /experimental/workspace/status": "Workspace status",
  "DELETE /experimental/workspace/{id}": "Workspace removed",
  "POST /experimental/workspace/{id}/session-restore": "Session replay started",
  "GET /project": "List of projects",
  "GET /project/current": "Current project information",
  "POST /project/git/init": "Project information after git initialization",
  "PATCH /project/{projectID}": "Updated project information",
  "GET /pty/shells": "List of shells",
  "GET /pty": "List of sessions",
  "POST /pty": "Created session",
  "GET /pty/{ptyID}": "Session info",
  "PUT /pty/{ptyID}": "Updated session",
  "DELETE /pty/{ptyID}": "Session removed",
  "GET /pty/{ptyID}/connect": "Connected session",
  "GET /config": "Get config info",
  "PATCH /config": "Successfully updated config",
  "GET /config/providers": "List of providers",
  "GET /experimental/console": "Active Console provider metadata",
  "GET /experimental/console/orgs": "Switchable Console orgs",
  "POST /experimental/console/switch": "Switch success",
  "GET /experimental/tool/ids": "Tool IDs",
  "GET /experimental/tool": "Tools",
  "POST /experimental/worktree": "Worktree created",
  "GET /experimental/worktree": "List of worktree directories",
  "DELETE /experimental/worktree": "Worktree removed",
  "POST /experimental/worktree/reset": "Worktree reset",
  "GET /experimental/session": "List of sessions",
  "GET /experimental/resource": "MCP resources",
  "GET /session": "List of sessions",
  "POST /session": "Successfully created session",
  "GET /session/status": "Get session status",
  "GET /session/{sessionID}": "Get session",
  "DELETE /session/{sessionID}": "Successfully deleted session",
  "PATCH /session/{sessionID}": "Successfully updated session",
  "GET /session/{sessionID}/children": "List of children",
  "GET /session/{sessionID}/todo": "Todo list",
  "POST /session/{sessionID}/init": "200",
  "POST /session/{sessionID}/fork": "200",
  "POST /session/{sessionID}/abort": "Aborted session",
  "POST /session/{sessionID}/share": "Successfully shared session",
  "DELETE /session/{sessionID}/share": "Successfully unshared session",
  "GET /session/{sessionID}/diff": "Successfully retrieved diff",
  "POST /session/{sessionID}/summarize": "Summarized session",
  "GET /session/{sessionID}/message": "List of messages",
  "POST /session/{sessionID}/message": "Created message",
  "GET /session/{sessionID}/message/{messageID}": "Message",
  "DELETE /session/{sessionID}/message/{messageID}": "Successfully deleted message",
  "DELETE /session/{sessionID}/message/{messageID}/part/{partID}": "Successfully deleted part",
  "PATCH /session/{sessionID}/message/{messageID}/part/{partID}": "Successfully updated part",
  "POST /session/{sessionID}/command": "Created message",
  "POST /session/{sessionID}/shell": "Created message",
  "POST /session/{sessionID}/revert": "Updated session",
  "POST /session/{sessionID}/unrevert": "Updated session",
  "POST /session/{sessionID}/permissions/{permissionID}": "Permission processed successfully",
  "POST /permission/{requestID}/reply": "Permission processed successfully",
  "GET /permission": "List of pending permissions",
  "GET /question": "List of pending questions",
  "POST /question/{requestID}/reply": "Question answered successfully",
  "POST /question/{requestID}/reject": "Question rejected successfully",
  "GET /provider": "List of providers",
  "GET /provider/auth": "Provider auth methods",
  "POST /provider/{providerID}/oauth/authorize": "Authorization URL and method",
  "POST /provider/{providerID}/oauth/callback": "OAuth callback processed successfully",
  "POST /sync/start": "Workspace sync started",
  "POST /sync/replay": "Replayed sync events",
  "POST /sync/history": "Sync events",
  "GET /find": "Matches",
  "GET /find/file": "File paths",
  "GET /find/symbol": "Symbols",
  "GET /file": "Files and directories",
  "GET /file/content": "File content",
  "GET /file/status": "File status",
  "GET /mcp": "MCP server status",
  "POST /mcp": "MCP server added successfully",
  "POST /mcp/{name}/auth": "OAuth flow started",
  "DELETE /mcp/{name}/auth": "OAuth credentials removed",
  "POST /mcp/{name}/auth/callback": "OAuth authentication completed",
  "POST /mcp/{name}/auth/authenticate": "OAuth authentication completed",
  "POST /mcp/{name}/connect": "MCP server connected successfully",
  "POST /mcp/{name}/disconnect": "MCP server disconnected successfully",
  "POST /tui/append-prompt": "Prompt processed successfully",
  "POST /tui/open-help": "Help dialog opened successfully",
  "POST /tui/open-sessions": "Session dialog opened successfully",
  "POST /tui/open-themes": "Theme dialog opened successfully",
  "POST /tui/open-models": "Model dialog opened successfully",
  "POST /tui/submit-prompt": "Prompt submitted successfully",
  "POST /tui/clear-prompt": "Prompt cleared successfully",
  "POST /tui/execute-command": "Command executed successfully",
  "POST /tui/show-toast": "Toast notification shown successfully",
  "POST /tui/publish": "Event published successfully",
  "POST /tui/select-session": "Session selected successfully",
  "GET /tui/control/next": "Next TUI request",
  "POST /tui/control/response": "Response submitted successfully",
  "POST /instance/dispose": "Instance disposed",
  "GET /vcs": "VCS info",
  "GET /vcs/diff": "VCS diff",
  "GET /command": "List of commands",
  "GET /agent": "List of agents",
  "GET /skill": "List of skills",
  "GET /lsp": "LSP server status",
  "GET /formatter": "Formatter status",
} as const satisfies Record<string, string>

const LegacyErrorResponses = {
  "PUT /auth/{providerID}": [400],
  "DELETE /auth/{providerID}": [400],
  "POST /log": [400],
  "PATCH /global/config": [400],
  "POST /global/upgrade": [400],
  "POST /experimental/workspace": [400],
  "POST /experimental/console/switch": [400],
  "DELETE /experimental/workspace/{id}": [400],
  "POST /experimental/workspace/{id}/session-restore": [400],
  "GET /experimental/tool/ids": [400],
  "GET /experimental/tool": [400],
  "POST /experimental/worktree": [400],
  "DELETE /experimental/worktree": [400],
  "POST /experimental/worktree/reset": [400],
  "PATCH /config": [400],
  "PATCH /project/{projectID}": [400, 404],
  "POST /pty": [400],
  "GET /pty/{ptyID}": [404],
  "PUT /pty/{ptyID}": [400],
  "DELETE /pty/{ptyID}": [404],
  "GET /pty/{ptyID}/connect": [404],
  "POST /session": [400],
  "GET /session/status": [400],
  "GET /session/{sessionID}": [400, 404],
  "DELETE /session/{sessionID}": [400, 404],
  "PATCH /session/{sessionID}": [400, 404],
  "GET /session/{sessionID}/children": [400, 404],
  "GET /session/{sessionID}/todo": [400, 404],
  "POST /session/{sessionID}/init": [400, 404],
  "POST /session/{sessionID}/abort": [400, 404],
  "POST /session/{sessionID}/share": [400, 404],
  "DELETE /session/{sessionID}/share": [400, 404],
  "POST /session/{sessionID}/summarize": [400, 404],
  "GET /session/{sessionID}/message": [400, 404],
  "POST /session/{sessionID}/message": [400, 404],
  "GET /session/{sessionID}/message/{messageID}": [400, 404],
  "DELETE /session/{sessionID}/message/{messageID}": [400, 404],
  "DELETE /session/{sessionID}/message/{messageID}/part/{partID}": [400, 404],
  "PATCH /session/{sessionID}/message/{messageID}/part/{partID}": [400, 404],
  "POST /session/{sessionID}/prompt_async": [400, 404],
  "POST /session/{sessionID}/command": [400, 404],
  "POST /session/{sessionID}/shell": [400, 404],
  "POST /session/{sessionID}/revert": [400, 404],
  "POST /session/{sessionID}/unrevert": [400, 404],
  "POST /session/{sessionID}/permissions/{permissionID}": [400, 404],
  "POST /permission/{requestID}/reply": [400, 404],
  "POST /question/{requestID}/reply": [400, 404],
  "POST /question/{requestID}/reject": [400, 404],
  "POST /provider/{providerID}/oauth/authorize": [400],
  "POST /provider/{providerID}/oauth/callback": [400],
  "POST /sync/replay": [400],
  "POST /sync/history": [400],
  "POST /mcp": [400],
  "POST /mcp/{name}/auth": [404],
  "POST /mcp/{name}/auth/callback": [400, 404],
  "POST /mcp/{name}/auth/authenticate": [404],
  "DELETE /mcp/{name}/auth": [404],
  "POST /tui/append-prompt": [400],
  "POST /tui/execute-command": [400],
  "POST /tui/publish": [400],
  "POST /tui/select-session": [400, 404],
} as const satisfies Record<string, ReadonlyArray<400 | 404>>

function matchLegacyOpenApi(input: Record<string, unknown>) {
  const spec = input as OpenApiSpec

  // Effect's multi-document JSON Schema deduplicator can produce self-referencing
  // component schemas (e.g. `{"$ref":"#/components/schemas/X"}` as the definition
  // of X itself) when the same AST node appears both as a standalone endpoint
  // payload and inside an annotated union arm. Resolve these by inlining the
  // actual schema from any parent union that references them.
  fixSelfReferencingComponents(spec)

  // Effect's Schema.optional emits `anyOf: [T, {type:"null"}]` in OpenAPI,
  // but the legacy SDK expected plain `T` for optional fields. Strip null
  // from all component schemas so both request and response types match.
  for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
    spec.components!.schemas![name] = stripOptionalNull(structuredClone(schema))
  }
  addLegacyErrorSchemas(spec)
  delete spec.components?.schemas?.Unauthorized
  delete spec.components?.schemas?.EffectHttpApiErrorBadRequest
  delete spec.components?.schemas?.EffectHttpApiErrorNotFound
  delete spec.components?.securitySchemes

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const isInstanceRoute = !path.startsWith("/global/") && !path.startsWith("/auth/")
    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      const operation = item[method]
      if (!operation) continue
      if (operation.requestBody) {
        // Hono's generated OpenAPI never marked request bodies as required. Keep
        // that SDK surface stable during the HttpApi migration.
        delete operation.requestBody.required
        if (path === "/experimental/workspace" && method === "post") {
          // Workspace creation fields `branch` and `extra` are Schema.NullOr —
          // genuinely nullable, not just optional. Re-add the null that the
          // component-level strip above removed.
          const ref = operation.requestBody.content?.["application/json"]?.schema?.$ref?.replace("#/components/schemas/", "")
          const properties = ref ? spec.components?.schemas?.[ref]?.properties : operation.requestBody.content?.["application/json"]?.schema?.properties
          if (properties?.branch) properties.branch = { anyOf: [properties.branch, { type: "null" }] }
          if (properties?.extra) properties.extra = { anyOf: [properties.extra, { type: "null" }] }
        }
      }
      // Hono applied auth as runtime middleware outside OpenAPI metadata, so the
      // legacy SDK did not expose auth schemes or generated 401 error unions.
      delete operation.security
      delete operation.responses?.["401"]
      normalizeLegacyErrorResponses(operation)
      if ((path === "/event" || path === "/global/event") && method === "get") {
        // HttpApi has no first-class SSE response schema, and these handlers are
        // raw/streaming routes. Document the actual wire protocol explicitly.
        operation.responses!["200"] = {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: path === "/event" ? { $ref: "#/components/schemas/Event" } : { $ref: "#/components/schemas/GlobalEvent" },
            },
          },
        }
      }
      // Apply response descriptions from the Hono spec to match legacy behavior
      const routeKey = `${method.toUpperCase()} ${path}` as keyof typeof ResponseDescriptions
      const responseDescription = ResponseDescriptions[routeKey]
      applyLegacyErrorResponses(operation, routeKey)
      inlineLegacyResponseSchemas(operation, routeKey)
      if (responseDescription && operation.responses?.["200"]) {
        const response200 = operation.responses["200"] as { description?: string }
        response200.description = responseDescription
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

function addLegacyErrorSchemas(spec: OpenApiSpec) {
  if (!spec.components?.schemas) return
  spec.components.schemas.BadRequestError = {
    type: "object",
    required: ["data", "errors", "success"],
    properties: {
      data: {},
      errors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: {},
        },
      },
      success: { type: "boolean", enum: [false] },
    },
  }
  spec.components.schemas.NotFoundError = {
    type: "object",
    required: ["name", "data"],
    properties: {
      name: { type: "string", enum: ["NotFoundError"] },
      data: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string" },
        },
      },
    },
  }
}

function normalizeLegacyErrorResponses(operation: OpenApiOperation) {
  if (operation.responses?.["400"] && isRefResponse(operation.responses["400"], "EffectHttpApiErrorBadRequest")) {
    operation.responses["400"] = legacyErrorResponse("Bad request", "BadRequestError")
  }
  if (operation.responses?.["404"] && isRefResponse(operation.responses["404"], "EffectHttpApiErrorNotFound")) {
    operation.responses["404"] = legacyErrorResponse("Not found", "NotFoundError")
  }
}

function applyLegacyErrorResponses(operation: OpenApiOperation, route: string) {
  const responses = LegacyErrorResponses[route as keyof typeof LegacyErrorResponses]
  if (!responses) return
  operation.responses ??= {}
  if (responses.includes(400)) operation.responses["400"] = legacyErrorResponse("Bad request", "BadRequestError")
  else if (operation.responses["400"] && isErrorResponse(operation.responses["400"], "BadRequest")) delete operation.responses["400"]
  if (responses.includes(404)) operation.responses["404"] = legacyErrorResponse("Not found", "NotFoundError")
  else if (operation.responses["404"] && isErrorResponse(operation.responses["404"], "NotFound")) delete operation.responses["404"]
}

function inlineLegacyResponseSchemas(operation: OpenApiOperation, route: string) {
  const response = operation.responses?.["200"]
  const schema = response?.content?.["application/json"]?.schema
  if (!schema) return
  if (route === "POST /mcp/{name}/auth") {
    response.content!["application/json"]!.schema = {
      type: "object",
      required: ["authorizationUrl"],
      properties: {
        authorizationUrl: { type: "string" },
      },
    }
    return
  }
  if (route === "DELETE /mcp/{name}/auth") {
    response.content!["application/json"]!.schema = {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean", enum: [true] },
      },
    }
    return
  }
  if (route === "POST /sync/replay") {
    response.content!["application/json"]!.schema = {
      type: "object",
      required: ["sessionID"],
      properties: {
        sessionID: { type: "string" },
      },
    }
  }
}

function isRefResponse(response: OpenApiResponse, name: string) {
  return response.content?.["application/json"]?.schema?.$ref === `#/components/schemas/${name}`
}

function isErrorResponse(response: OpenApiResponse, name: "BadRequest" | "NotFound") {
  return isRefResponse(response, `EffectHttpApiError${name}`) || isRefResponse(response, `${name}Error`)
}

function legacyErrorResponse(description: string, name: "BadRequestError" | "NotFoundError"): OpenApiResponse {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${name}` },
      },
    },
  }
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
