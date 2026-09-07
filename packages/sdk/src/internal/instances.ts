export * as SdkInstances from "./instances"

import { Instance } from "@opencode-ai/core/instance"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Plugin } from "@opencode-ai/core/plugin"
import type { InstancePlugins } from "@opencode-ai/core/plugin/instance"
import { Location } from "@opencode-ai/schema/location"
import type { Session } from "@opencode-ai/schema/session"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import type { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Context, Duration, Effect, Layer, LayerMap, Scope } from "effect"

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

/** Replaces the host's `Instance.node`; `replacements` resolves lazily so instances inherit the final host graph. */
export function node(options: Options, replacements: () => LayerNode.Replacements) {
  return makeGlobalNode({
    service: Instance.Service,
    layer: layer(options, replacements),
    deps: [LocationServiceMap.node],
  })
}

export function layer(options: Options, replacements: () => LayerNode.Replacements) {
  return Layer.effect(
    Instance.Service,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const locations = yield* LocationServiceMap.Service
      const key = (session: Session.Info) => ({
        key: options.key(session),
        ...LocationServiceMap.canonical(session.location),
      })
      const provide = (session: Session.Info) => Effect.provide(instances.get(key(session)))
      const instances: LayerMap.LayerMap<ReturnType<typeof key>, Instance.Services> = yield* LayerMap.make(
        (input: ReturnType<typeof key>) =>
          Layer.unwrap(
            Effect.gen(function* () {
              const configuration = yield* options.configure(input.key).pipe(Effect.orDie)
              return Instance.layer(Location.Ref.make({ directory: input.directory, workspaceID: input.workspaceID }), {
                plugins: configuration.plugins,
                replacements: [
                  ...replacements(),
                  // Instances borrow this selector and the host's Location map instead of retaining
                  // their Layer scopes; retaining the selector would block its shutdown on its own entries.
                  Instance.node.replace(Layer.succeed(Instance.Service, { provide })),
                  LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, locations)),
                ],
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
              instances.invalidate(input).pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid),
            ),
          ),
        { idleTimeToLive: Duration.infinity },
      )
      return Instance.Service.of({ provide })
    }),
  )
}
