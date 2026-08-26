import { Location } from "@opencode-ai/schema/location"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
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
    HttpApiEndpoint.get("plugin.check", "/api/plugin/update", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Plugin.UpdateInfo)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.plugin.check",
          summary: "Check plugin updates",
          description: "Check configured plugins for explicitly available updates.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.update", "/api/plugin/update", {
      payload: Schema.Struct({ name: Schema.String }),
      query: LocationQuery,
      success: Location.response(Plugin.UpdateResult),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.plugin.update",
          summary: "Update plugin",
          description: "Explicitly update one configured plugin and reload plugins when it changes.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.updateAll", "/api/plugin/update-all", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Plugin.UpdateResult)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.plugin.updateAll",
          summary: "Update plugins",
          description: "Explicitly update every updateable configured plugin and reload changed plugins.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "plugin",
      description: "Experimental plugin routes.",
    }),
  )
