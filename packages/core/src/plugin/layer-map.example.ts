export * as LayerMapExample from "./layer-map.example"

import { Context, Effect, Layer, LayerMap } from "effect"
import { Npm } from "../npm"

/**
 * Tutorial: split global services from context-specific services.
 *
 * Use this pattern when part of the app should be constructed once at the app edge,
 * while another part should be cached per request/project/workspace key.
 *
 * In this example:
 * - Npm.Service is the global service. It is not keyed by request context and should
 *   be provided once by the application runtime.
 * - ConfigService is context-specific. It is built from a RequestContext key and is
 *   cached by LayerMap for that key.
 * - ConfigServiceMap.layer owns the cache. Provide it once globally, then each
 *   request can provide ConfigServiceMap.get(context) to select the right instance.
 *
 * Lifetime model:
 * - ConfigServiceMap.layer has the app/global lifetime and depends on Npm.Service.
 * - ConfigServiceMap.get(context) has the request/context lifetime and provides
 *   ConfigService for exactly that context key.
 * - The cached ConfigService entry stays alive while something is using it. Once idle,
 *   it remains cached for idleTimeToLive, then its scope is finalized.
 * - invalidate(context) removes the cache entry for future lookups. Active users keep
 *   running on the old instance; the next lookup can create a fresh instance.
 *
 * Key model:
 * - Keys can be strings, structs, classes, arrays, etc.
 * - Prefer primitive or immutable keys. Effect uses Hash / Equal semantics for cache
 *   lookup, so mutating an object after it has been used as a key is a bug.
 */

export type RequestContext = {
  readonly directory: string
  readonly workspace: string
}

export class RequestContextRef extends Context.Service<RequestContextRef, RequestContext>()(
  "@opencode/example/RequestContextRef",
) {}

export interface ConfigServiceShape {
  readonly directory: string
  readonly workspace: string
  readonly nextUse: () => Effect.Effect<number>
  readonly which: Npm.Interface["which"]
}

export class ConfigService extends Context.Service<ConfigService, ConfigServiceShape>()(
  "@opencode/example/ConfigService",
) {}

const configServiceLayer = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const context = yield* RequestContextRef
    const npm = yield* Npm.Service

    let useCount = 0

    return ConfigService.of({
      directory: context.directory,
      workspace: context.workspace,
      nextUse: () => Effect.succeed(++useCount),
      which: npm.which,
    })
  }),
)

export class ConfigServiceMap extends LayerMap.Service<ConfigServiceMap>()("@opencode/example/ConfigServiceMap", {
  lookup: (context: RequestContext) =>
    configServiceLayer.pipe(Layer.provide(Layer.succeed(RequestContextRef, RequestContextRef.of(context)))),
  idleTimeToLive: "5 minutes",
}) {}

export const appLayer = ConfigServiceMap.layer

export const readConfig = Effect.fn("LayerMapExample.readConfig")(function* () {
  const config = yield* ConfigService

  return {
    directory: config.directory,
    workspace: config.workspace,
    useCount: yield* config.nextUse(),
  }
})

export const handleRequest = Effect.fn("LayerMapExample.handleRequest")(function* (context: RequestContext) {
  return yield* readConfig().pipe(Effect.provide(ConfigServiceMap.get(context)))
})

export const invalidateContext = (context: RequestContext) => ConfigServiceMap.invalidate(context)
