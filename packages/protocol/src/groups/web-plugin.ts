import { Plugin } from "@opencode/schema/plugin"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError, LocationNotFoundError, PluginNotFoundError } from "../errors.js"

export const WEB_PLUGIN_MODULE_PATH = "/api/experimental/plugin/web-module"

const description = "Experimental: may change without compatibility guarantees."

export const WebPluginEndpoints = [
  HttpApiEndpoint.post("plugin.webList", "/api/experimental/plugin/web-list", {
    success: Schema.Array(
      Schema.Struct({
        id: Plugin.ID,
        revision: Schema.String,
        options: Plugin.GuiBundle.fields.options,
        ticket: Schema.String,
      }),
    ),
    error: [ForbiddenError, LocationNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.plugin.webList",
      summary: "List web plugin modules",
      description: `List active GUIs in the server's startup directory with a short-lived, single-use module ticket. ${description}`,
    }),
  ),
  HttpApiEndpoint.get("plugin.webModule", WEB_PLUGIN_MODULE_PATH, {
    query: { id: Plugin.ID, revision: Schema.String, ticket: Schema.String },
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "text/javascript" })),
    error: [ForbiddenError, LocationNotFoundError, PluginNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.plugin.webModule",
      summary: "Load a web plugin module",
      description: `Consume a ticket for the exact plugin and revision and return its CommonJS factory as JavaScript. ${description}`,
    }),
  ),
] as const
