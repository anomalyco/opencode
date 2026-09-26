import { Location } from "@opencode/schema/location"
import { Plugin } from "@opencode/schema/plugin"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const PluginGroup = HttpApiGroup.make("server.plugin")
  .add(
    HttpApiEndpoint.get("plugin.list", "/api/plugin", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Plugin.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "plugin.list",
          summary: "List plugins",
          description: "Retrieve enabled server plugins and their current status.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.check", "/api/plugin/check", {
      query: LocationQuery,
      payload: Schema.Struct({ target: Schema.String.pipe(Schema.optional) }),
      success: Location.response(Schema.Array(Plugin.Info)),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "plugin.check",
          summary: "Check plugin updates",
          description: "Check one or all package plugins for available updates.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.update", "/api/plugin/update", {
      query: LocationQuery,
      payload: Schema.Struct({ targets: Schema.Array(Schema.String) }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "plugin.update",
          summary: "Update plugins",
          description:
            "Update package plugins concurrently and notify active locations to reload them. Responds once every update has finished; fails when any update fails.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.awaitActivation", "/api/plugin/await-activation", {
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "plugin.awaitActivation",
          summary: "Await plugin activation",
          description:
            "Wait until plugin activation has settled for the location. Clients that read plugin-derived state (the model catalog, agents, commands) should call this before their first read so async discovery rounds have a chance to land. Required after v2.0.4 to surface user-config providers in the ACP session catalog.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "plugin",
      description: "Experimental plugin routes.",
    }),
  )
