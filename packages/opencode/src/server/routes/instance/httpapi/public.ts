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
  schema?: unknown
}

type OpenApiOperation = {
  parameters?: OpenApiParameter[]
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
  items?: OpenApiSchema
  oneOf?: OpenApiSchema[]
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
      }
      if (!isInstanceRoute) continue
      operation.parameters = [
        ...InstanceQueryParameters,
        ...(operation.parameters ?? []).filter(
          (param) => param.in !== "query" || (param.name !== "directory" && param.name !== "workspace"),
        ),
      ]
    }
  }
  return input
}

function normalizeRequestSchema(schema: OpenApiSchema): OpenApiSchema {
  const options = schema.anyOf ?? schema.oneOf
  if (options) {
    const withoutNull = options.filter((item) => item.type !== "null")
    const finite = withoutNull.find((item) => item.type === "number")
    if (finite && withoutNull.every((item) => item.type === "number" || item.type === "string")) return finite
    if (withoutNull.length === 1) return normalizeRequestSchema(withoutNull[0])
    if (schema.anyOf) schema.anyOf = withoutNull.map(normalizeRequestSchema)
    if (schema.oneOf) schema.oneOf = withoutNull.map(normalizeRequestSchema)
  }
  if (schema.allOf) schema.allOf = schema.allOf.map(normalizeRequestSchema)
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
