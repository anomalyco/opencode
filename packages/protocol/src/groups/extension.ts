import { Extension } from "@opencode/schema/extension"
import { Mcp } from "@opencode/schema/mcp"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

const root = "/api/extension"

export const ExtensionGroup = HttpApiGroup.make("server.extension")
  .add(
    HttpApiEndpoint.get("extension.list", root, {
      success: Schema.Array(Extension.CIR),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "extension.list",
        summary: "List installed extensions",
        description: "Returns all universal extensions installed across global and project scopes.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("extension.install", `${root}/install`, {
      payload: Extension.InstallInput,
      success: Extension.CIR,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "extension.install",
        summary: "Install extension",
        description: "Installs a skill, rule, MCP, or plugin from a Git URL, local path, or archive.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("extension.toggle", `${root}/:id/toggle`, {
      params: { id: Schema.String },
      payload: Schema.Struct({ enabled: Schema.Boolean }),
      success: Schema.optional(Extension.CIR),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "extension.toggle",
        summary: "Toggle extension state",
        description: "Enables or disables an extension.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("extension.remove", `${root}/:id`, {
      params: { id: Schema.String },
      success: Schema.Boolean,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "extension.remove",
        summary: "Uninstall extension",
        description: "Removes an extension from the system.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("extension.mcp.test", `${root}/mcp/test`, {
      payload: Schema.Struct({ name: Schema.String, config: Mcp.ServerConfig }),
      success: Extension.McpDiagnosticResult,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "extension.mcp.test",
        summary: "Test MCP server connectivity",
        description: "Runs deep diagnostics and tool discovery against an MCP server configuration.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "extension",
      description: "Universal Agent Extension routes.",
    }),
  )
