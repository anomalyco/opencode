import { Config } from "@opencode/core/config"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { Effect } from "effect"
import type { HttpServerRequest } from "effect/http"
import { awaitPlugins, locationErrors, requestRef, response } from "../location"

/**
 * `plugin.web` in the `server.experimental` group: the plugins whose `./gui-experimental` window setup a browser tab
 * loads. A tab runs that code with its own sign-in, so the list stays empty unless the Location's config sets
 * `experimental.plugin_gui_web` to `true` or to the plugin's id.
 */
export const makePluginWeb = Effect.gen(function* () {
  const locations = yield* LocationServiceMap.Service

  return (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const config = yield* Config.Service
      const allowed = Config.latest(yield* config.entries(), "experimental")?.plugin_gui_web
      const plugins = yield* Plugin.Service

      if (!allowed) return yield* response(Effect.succeed([]))

      // A tab lists as it loads, so it waits for the Location's plugins rather than seeing part of them.
      yield* awaitPlugins

      return yield* response(
        plugins
          .list()
          .pipe(
            Effect.map((listed) =>
              listed.filter(
                (plugin) =>
                  plugin.id !== undefined &&
                  plugin.source.type !== "builtin" &&
                  plugin.state.status === "active" &&
                  plugin.features.gui === true &&
                  (allowed === true || allowed.includes(plugin.id)),
              ),
            ),
          ),
      )
    }).pipe(Effect.provide(locations.get(requestRef(request))), locationErrors)
})
