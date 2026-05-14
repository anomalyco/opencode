import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

const root = "/plugin"

const SidebarPanelItemSchema = Schema.Struct({
  label: Schema.String,
  value: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literal("success", "warning", "error", "info")),
}).annotate({ identifier: "SidebarPanelItem" })

const SidebarPanelSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  items: Schema.Array(SidebarPanelItemSchema),
}).annotate({ identifier: "SidebarPanel" })

const PluginSidebarResponse = Schema.Struct({
  panels: Schema.Array(SidebarPanelSchema),
}).annotate({ identifier: "PluginSidebarResponse" })

export const PluginPaths = {
  sidebar: `${root}/sidebar`,
} as const

export const PluginApi = HttpApi.make("plugin")
  .add(
    HttpApiGroup.make("plugin")
      .add(
        HttpApiEndpoint.get("sidebar", PluginPaths.sidebar, {
          query: WorkspaceRoutingQuery,
          success: PluginSidebarResponse,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "plugin.sidebar",
            summary: "Get plugin sidebar panels",
            description: "Returns aggregated sidebar panels from all registered plugins.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "plugin", description: "Plugin sidebar API." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode plugin HttpApi",
      version: "0.0.1",
      description: "HttpApi surface for plugin-contributed UI.",
    }),
  )
