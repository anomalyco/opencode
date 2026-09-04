import { Location } from "@opencode-ai/schema/location"
import { Plugin } from "@opencode-ai/schema/plugin"
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
          identifier: "v2.plugin.list",
          summary: "List plugins",
          description: "Retrieve enabled server plugins and their current status.",
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
          identifier: "v2.plugin.awaitActivation",
          summary: "Wait for plugin activation",
          description:
            "Wait for configured plugin activation at a Location to settle, including missing-package installs. Completion does not imply every plugin succeeded or background resource discovery finished. Cancelling this wait does not cancel activation.",
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
          identifier: "v2.plugin.check",
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
          identifier: "v2.plugin.update",
          summary: "Update plugins",
          description:
            "Update package plugins concurrently and notify active locations to reload them. Responds once every update has finished; fails when any update fails.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "plugin",
      description: "Experimental plugin routes.",
    }),
  )
