import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { PtyTicket } from "@opencode/core/pty/ticket"
import { AbsolutePath } from "@opencode/core/schema"
import { ForbiddenError, PluginNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { locationErrors } from "../location"

// Only the server that serves the page contributes modules. Neither route takes a Location from the caller.
export const makeWebPlugin = Effect.gen(function* () {
  const locations = yield* LocationServiceMap.Service
  const tickets = yield* PtyTicket.Service
  const ref = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
  const own = (request: HttpServerRequest.HttpServerRequest) =>
    (!request.headers["sec-fetch-site"] || request.headers["sec-fetch-site"] === "same-origin") &&
    (!request.headers.origin || URL.parse(request.headers.origin)?.host === request.headers.host)

  return {
    list: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        if (!own(request)) return yield* new ForbiddenError({ message: "Web plugin modules are same-origin only" })
        const plugins = yield* Plugin.Service
        return yield* Effect.forEach(yield* plugins.guis(), (gui) =>
          tickets.issue({ pluginGui: gui }).pipe(Effect.map(({ ticket }) => ({ ...gui, ticket }))),
        )
      }).pipe(Effect.provide(locations.get(ref)), locationErrors),

    module: (
      query: { id: Plugin.ID; revision: string; ticket: string },
      request: HttpServerRequest.HttpServerRequest,
    ) =>
      Effect.gen(function* () {
        if (!own(request) || !(yield* tickets.consume({ pluginGui: query, ticket: query.ticket })))
          return yield* new ForbiddenError({ message: "Invalid web plugin module ticket" })
        return yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const bundle = yield* plugins.gui(query.id)
          if (!bundle || bundle.revision !== query.revision)
            return yield* new PluginNotFoundError({
              pluginID: query.id,
              message: "Plugin revision is no longer active",
            })
          return HttpServerResponse.text(`export default function(require, module, exports) {\n${bundle.code}\n}\n`, {
            contentType: "text/javascript",
            headers: {
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
              "cross-origin-resource-policy": "same-origin",
              "referrer-policy": "no-referrer",
            },
          })
        }).pipe(Effect.provide(locations.get(ref)), locationErrors)
      }),
  }
})
