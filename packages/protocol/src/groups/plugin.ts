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
          description: "Retrieve currently loaded plugins.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "plugin",
      description: "Experimental plugin routes.",
    }),
  )
