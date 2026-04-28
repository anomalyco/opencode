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
}

type OpenApiPathItem = Partial<Record<"get" | "post" | "put" | "delete" | "patch", OpenApiOperation>>

type OpenApiSpec = {
  paths?: Record<string, OpenApiPathItem>
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

function documentInstanceQueryParameters(input: Record<string, unknown>) {
  const spec = input as OpenApiSpec
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (path.startsWith("/global/") || path.startsWith("/auth/")) continue
    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      const operation = item[method]
      if (!operation) continue
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
      transform: documentInstanceQueryParameters,
    }),
  )
