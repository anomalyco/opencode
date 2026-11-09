import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import type { ServerOptions } from "../../src/options"
import { createRoutes } from "../../src/routes"

// The server never waits for a Location's plugins to load. A test that sets up a Location does, so it can
// exercise plugin-provided entries without polling.
export const pluginsLoaded = (context: Context.Context<LocationServiceMap.Service>, directory: string) =>
  Plugin.awaitActivation.pipe(
    Effect.provide(
      Context.get(context, LocationServiceMap.Service).get(
        Location.Ref.make({ directory: AbsolutePath.make(directory) }),
      ),
    ),
  )

// Serves the routes in this process so the test can reach the Location's plugins.
export const serveRoutes = Effect.fnUntraced(function* (
  options: ServerOptions,
  overrides: LayerNode.Replacements = [],
) {
  const context = yield* Layer.build(
    createRoutes(options, () => [], overrides).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  return {
    context,
    handler,
    fetch: (input: string | URL, init?: RequestInit) => handler(new Request(input, init)),
    pluginsLoaded: (directory: string) => pluginsLoaded(context, directory),
  }
})
