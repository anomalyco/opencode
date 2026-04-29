import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { ConfigApi } from "./config"
import { ControlApi } from "./control"
import { EventApi } from "./event"
import { ExperimentalApi } from "./experimental"
import { FileApi } from "./file"
import { GlobalApi } from "./global"
import { InstanceApi } from "./instance"
import { McpApi } from "./mcp"
import { PermissionApi } from "./permission"
import { ProjectApi } from "./project"
import { ProviderApi } from "./provider"
import { PtyApi, PtyConnectApi } from "./pty"
import { QuestionApi } from "./question"
import { SessionApi } from "./session"
import { SyncApi } from "./sync"
import { TuiApi } from "./tui"
import { WorkspaceApi } from "./workspace"

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

const LegacyBodyRefParameters = new Set(["Auth", "Config", "Part", "WorktreeRemoveInput", "WorktreeResetInput"])
const FiniteNumberValues = new Set(["Infinity", "-Infinity", "NaN"])
const QueryNumberParameters = new Set(["start", "cursor", "limit", "method"])
const QueryBooleanParameters = new Set(["roots", "archived"])
const QueryParameterSchemas = {
  "GET /find/file limit": { type: "integer", minimum: 1, maximum: 200 },
  "GET /session/{sessionID}/message limit": { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
} satisfies Record<string, OpenApiSchema>

function matchLegacyOpenApi(input: Record<string, unknown>) {
  const spec = input as OpenApiSpec
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const isInstanceRoute = !path.startsWith("/global/") && !path.startsWith("/auth/")
    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      const operation = item[method]
      if (!operation) continue
      if (operation.requestBody) {
        delete operation.requestBody.required
        for (const media of Object.values(operation.requestBody.content ?? {})) {
          const ref = media.schema?.$ref?.replace("#/components/schemas/", "")
          if (ref && LegacyBodyRefParameters.has(ref)) continue
          if (ref && spec.components?.schemas?.[ref]) {
            media.schema = normalizeRequestSchema(structuredClone(spec.components.schemas[ref]))
            continue
          }
          if (media.schema) media.schema = normalizeRequestSchema(media.schema)
        }
        if (path === "/experimental/workspace" && method === "post") {
          const properties = operation.requestBody.content?.["application/json"]?.schema?.properties
          if (properties?.branch) properties.branch = { anyOf: [properties.branch, { type: "null" }] }
          if (properties?.extra) properties.extra = { anyOf: [properties.extra, { type: "null" }] }
        }
        if (path === "/tui/publish" && method === "post" && spec.components?.schemas) {
          const schema = operation.requestBody.content?.["application/json"]?.schema
          const anyOf = schema?.anyOf
          if (anyOf?.length === 4) {
            spec.components.schemas.EventTuiPromptAppend = anyOf[0]
            spec.components.schemas.EventTuiCommandExecute = anyOf[1]
            spec.components.schemas.EventTuiToastShow = anyOf[2]
            spec.components.schemas.EventTuiSessionSelect = anyOf[3]
            operation.requestBody.content!["application/json"]!.schema = {
              anyOf: [
                { $ref: "#/components/schemas/EventTuiPromptAppend" },
                { $ref: "#/components/schemas/EventTuiCommandExecute" },
                { $ref: "#/components/schemas/EventTuiToastShow" },
                { $ref: "#/components/schemas/EventTuiSessionSelect" },
              ],
            }
          }
        }
        if (path === "/sync/replay" && method === "post" && spec.components?.schemas?.SyncReplayEvent) {
          const events = operation.requestBody.content?.["application/json"]?.schema?.properties?.events
          if (events?.items?.$ref === "#/components/schemas/SyncReplayEvent") {
            events.items = normalizeRequestSchema(structuredClone(spec.components.schemas.SyncReplayEvent))
          }
        }
      }
      if ((path === "/event" || path === "/global/event") && method === "get") {
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

function normalizeRequestSchema(schema: OpenApiSchema): OpenApiSchema {
  const options = flattenOptions(schema.anyOf ?? schema.oneOf)
  if (options) {
    const withoutNull = options.filter((item) => item.type !== "null")
    const finite = withoutNull.find((item) => item.type === "number")
    if (finite && withoutNull.every(isFiniteNumberOption)) return { type: "number" }
    if (withoutNull.length === 1) return normalizeRequestSchema(withoutNull[0])
    if (schema.anyOf) schema.anyOf = withoutNull.map(normalizeRequestSchema)
    if (schema.oneOf) schema.oneOf = withoutNull.map(normalizeRequestSchema)
  }
  if (schema.allOf) {
    if (schema.type) delete schema.allOf
    else schema.allOf = schema.allOf.map(normalizeRequestSchema)
  }
  if (schema.prefixItems && schema.items) delete schema.prefixItems
  if (schema.items) schema.items = normalizeRequestSchema(schema.items)
  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      schema.properties[key] = normalizeRequestSchema(value)
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    schema.additionalProperties = normalizeRequestSchema(schema.additionalProperties)
  }
  return schema
}

function flattenOptions(options: OpenApiSchema[] | undefined): OpenApiSchema[] | undefined {
  return options?.flatMap((item) => flattenOptions(item.anyOf ?? item.oneOf) ?? [item])
}

function isFiniteNumberOption(schema: OpenApiSchema) {
  if (schema.type === "number") return true
  return schema.type === "string" && schema.enum?.every((value) => FiniteNumberValues.has(value)) === true
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
  param.schema = normalizeRequestSchema(param.schema)
}

export const PublicApi = HttpApi.make("opencode")
  .addHttpApi(ControlApi)
  .addHttpApi(GlobalApi)
  .addHttpApi(EventApi)
  .addHttpApi(ConfigApi)
  .addHttpApi(ExperimentalApi)
  .addHttpApi(FileApi)
  .addHttpApi(InstanceApi)
  .addHttpApi(McpApi)
  .addHttpApi(PermissionApi)
  .addHttpApi(ProjectApi)
  .addHttpApi(ProviderApi)
  .addHttpApi(PtyApi)
  .addHttpApi(PtyConnectApi)
  .addHttpApi(QuestionApi)
  .addHttpApi(SessionApi)
  .addHttpApi(SyncApi)
  .addHttpApi(TuiApi)
  .addHttpApi(WorkspaceApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode",
      version: "1.0.0",
      description: "opencode api",
      transform: matchLegacyOpenApi,
    }),
  )
