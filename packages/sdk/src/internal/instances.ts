export * as SdkInstances from "./instances"

import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import type { InstancePlugins } from "@opencode/core/plugin/instance"
import type { Session } from "@opencode/schema/session"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Scope } from "effect"

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
      if (!locations.instances)
        return yield* Effect.die(new Error("SdkInstances needs the host's own LocationServiceMap"))
      // Private instances live in the host's map, so they share its Location lifecycle and close before Stage-1
      // globals. They read this selector and the map from the host context and never retain their Layer scopes;
      // retaining the selector would block its shutdown on its own entries.
      const instances = yield* locations.instances((ref, key, host) =>
        Layer.unwrap(
          Effect.gen(function* () {
            const configuration = yield* options.configure(key).pipe(Effect.orDie)
            return Instance.layer(ref, { plugins: configuration.plugins, host }).pipe(
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
        ),
      )
      return Instance.Service.of({
        provide: (session) => Effect.provide(instances.get(session.location, options.key(session))),
        live: (session) => instances.has(session.location, options.key(session)),
      })
    }),
  )
}
