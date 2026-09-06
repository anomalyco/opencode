import { Agent } from "@opencode-ai/schema/agent"
import { Command } from "@opencode-ai/schema/command"
import { Form } from "@opencode-ai/schema/form"
import { Integration } from "@opencode-ai/schema/integration"
import { Location } from "@opencode-ai/schema/location"
import { Mcp } from "@opencode-ai/schema/mcp"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Reference } from "@opencode-ai/schema/reference"
import { Shell } from "@opencode-ai/schema/shell"
import { Skill } from "@opencode-ai/schema/skill"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors.js"

export const LocationQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "LocationQuery" })

// Everything a client reads to render a location, except VCS state, which shells out to git and
// can take seconds; clients fetch that separately so it never delays the rest.
export const LocationCatalog = Schema.Struct({
  agent: Schema.Array(Agent.Info),
  command: Schema.Array(Command.Info),
  integration: Schema.Array(Integration.Info),
  mcp: Schema.Array(Mcp.Server),
  mcpResource: Mcp.ResourceCatalog,
  model: Schema.Array(Model.Info),
  provider: Schema.Array(Provider.Info),
  reference: Schema.Array(Reference.Info),
  skill: Schema.Array(Skill.Info),
  shell: Schema.Array(Shell.Info),
  form: Schema.Array(Form.Info),
}).annotate({ identifier: "LocationCatalog" })

export const locationQueryOpenApi = OpenApi.annotations({
  transform: (operation) => {
    const parameters = operation.parameters
    if (!Array.isArray(parameters)) return operation
    return {
      ...operation,
      parameters: parameters.map((parameter) =>
        parameter?.name === "location" && parameter?.in === "query"
          ? { ...parameter, style: "deepObject", explode: true }
          : parameter,
      ),
    }
  },
})

export const LocationGroup = HttpApiGroup.make("server.location")
  .add(
    HttpApiEndpoint.get("location.get", "/api/location", {
      query: LocationQuery,
      success: Location.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.location.get",
          summary: "Get location",
          description: "Resolve the requested location or the server default location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("location.catalog", "/api/location/catalog", {
      query: LocationQuery,
      success: Location.response(LocationCatalog),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.location.catalog",
          summary: "Get location catalog",
          description:
            "Read the agents, commands, integrations, MCP servers and resources, models, providers, references, skills, shells, and pending forms for a location in one response. Equivalent to calling each list endpoint with the same location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "location" }))
