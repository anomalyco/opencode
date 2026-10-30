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
    HttpApiEndpoint.post("extension.inspect", `${root}/inspect`, {
      payload: Schema.Struct({
        sourceUrlOrPath: Schema.String,
        subpath: Schema.optional(Schema.String),
        ref: Schema.optional(Schema.String),
      }),
      success: Extension.PackageInspectionResult,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "extension.inspect",
        summary: "Inspect extension or package",
        description: "Inspects a local folder, repository, or archive and decomposes it into component CIRs with security reports.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("extension.proposeAdapter", `${root}/adapter/propose`, {
      payload: Schema.Struct({ cir: Extension.CIR }),
      success: Extension.CompatibilityProposal,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "extension.proposeAdapter",
        summary: "Propose compatibility adapter",
        description: "Analyzes capability gaps and generates an adapter proposal with tests and validation.",
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
    HttpApiEndpoint.post("extension.rollback", `${root}/:id/rollback`, {
      params: { id: Schema.String },
      payload: Schema.Struct({ targetVersion: Schema.String }),
      success: Schema.optional(Extension.RollbackRecord),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "extension.rollback",
        summary: "Rollback extension version",
        description: "Rolls back an installed extension to a previous version.",
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
