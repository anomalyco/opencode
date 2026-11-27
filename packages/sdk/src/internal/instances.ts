export * as SdkInstances from "./instances"

import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import type { InstancePlugins } from "@opencode/core/plugin/instance"
import type { Session } from "@opencode/schema/session"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Duration, Effect, Exit, Layer, LayerMap, RcMap, Scope } from "effect"

export interface Configuration {
  readonly plugins: InstancePlugins.List
}

export interface Options<R = never> {
  /** Select a sharing key within the Session's current Location. Must not initialize plugins. */
  readonly key: (session: Session.Info) => string
  /**
   * Reconstruct configuration on a cache miss. Resources belong to the instance Scope; other requirements
   * are the services the SDK entrypoint was built with.
   */
  readonly configure: (key: string) => Effect.Effect<Configuration, unknown, R | Scope.Scope>
}

/** Closes `configure` over services captured where the SDK entrypoint was built; the host graph has none of its own. */
export function provide<R>(options: Options<R>, context: Context.Context<R>): Options {
  return {
    key: options.key,
    // The ambient side wins the merge, so the instance Scope owns configured resources rather than the
    // build Scope that was captured alongside the services.
    configure: (key) =>
      options
        .configure(key)
        .pipe(Effect.updateContext((ambient: Context.Context<Scope.Scope>) => Context.merge(context, ambient))),
  }
}

/** Replaces the host's `Instance.node` with per-session instances backed by the host's `LocationServiceMap`. */
export function node(options: Options) {
  return makeGlobalNode({
    service: Instance.Service,
    layer: layer(options),
    deps: [LocationServiceMap.node],
  })
}

function layer(options: Options) {
  return Layer.effect(
    Instance.Service,
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      const host = locations.host
      const instanceScope = locations.instanceScope
      if (!host || !instanceScope)
        return yield* Effect.die(new Error("SdkInstances needs the host's own LocationServiceMap"))
      const key = (session: Session.Info) => ({
        key: options.key(session),
        ...LocationServiceMap.canonical(session.location),
      })
      const provide = (session: Session.Info) => Effect.provide(instances.get(key(session)))
      // Owned by instanceScope so every private instance closes before Stage-1 globals tear down.
      const instances: LayerMap.LayerMap<
        ReturnType<typeof key>,
        Instance.Services,
        Instance.Error
      > = yield* LayerMap.make(
        (input: ReturnType<typeof key>) =>
          Layer.unwrap(
            Effect.gen(function* () {
              const configuration = yield* options.configure(input.key).pipe(Effect.orDie)
              // Instances read this selector and the host's Location map from the host context, so they never
              // retain their Layer scopes; retaining the selector would block its shutdown on its own entries.
              return Instance.layer(input, {
                plugins: configuration.plugins,
                host: yield* host,
              }).pipe(
                Layer.tap((context) =>
                  Effect.gen(function* () {
                    const plugins = yield* Plugin.Service
                    yield* plugins.awaitActivation
                    // Covers setup failures and IDs colliding with host plugins; Core reports both in the inventory.
                    const failed = (yield* plugins.list()).filter(
                      (plugin) =>
                        plugin.state.status === "failed" &&
                        configuration.plugins.some((configured) => configured.id === plugin.id),
                    )
                    if (failed.length > 0)
                      yield* Effect.die(
                        new Error(`Instance plugin setup failed: ${failed.map((plugin) => plugin.id).join(", ")}`),
                      )
                  }).pipe(Effect.provide(context)),
                ),
              )
            }),
          ).pipe(
            // Eviction can close the lookup's scope; do not make that fiber wait on itself.
            Layer.tapCause(() =>
              instances.invalidate(input).pipe(Effect.forkIn(instanceScope, { startImmediately: true }), Effect.asVoid),
            ),
          ),
        { idleTimeToLive: Duration.infinity },
      ).pipe(Scope.provide(instanceScope))
      // Close all open private instances concurrently before instanceScope tears down the RcMap and before
      // Stage-1 globals release.
      yield* Scope.addFinalizer(
        instanceScope,
        Effect.suspend(() =>
          instances.rcMap.state._tag === "Closed"
            ? Effect.void
            : Effect.forEach(
                instances.rcMap.state.map,
                ([, entry]) => Effect.exit(Scope.close(entry.scope, Exit.void)),
                { concurrency: "unbounded", discard: true },
              ),
        ),
      )
      return Instance.Service.of({ provide, live: (session) => RcMap.has(instances.rcMap, key(session)) })
    }),
  )
}
