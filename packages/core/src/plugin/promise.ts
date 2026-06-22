export * as PluginPromise from "./promise"

import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin, PluginContext, Registration } from "@opencode-ai/plugin/v2/promise"
import { Effect, Scope } from "effect"

// The Effect host hands back this registration shape; mirror it structurally so
// we do not have to alias the Effect package's `Registration` against the Promise one.
type HostRegistration = { readonly dispose: Effect.Effect<void> }

/**
 * Adapts a Promise plugin into an Effect plugin so the existing Effect-only
 * loader (`PluginV2` / `PluginBoot`) can run it unchanged.
 *
 * Hook registrations created during the async `setup` attach to the plugin's
 * scope, so unloading the plugin disposes them. The captured fiber context
 * preserves boot-time batching, so Promise-plugin transforms still coalesce
 * into one rebuild per domain.
 */
export function fromPromise(plugin: Plugin) {
  return define({
    id: plugin.id,
    effect: (host) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const context = yield* Effect.context<Scope.Scope>()

        // Run a hook registration on the plugin scope and resolve once it is registered.
        const register = (effect: Effect.Effect<HostRegistration, never, Scope.Scope>): Promise<Registration> =>
          Effect.runPromiseWith(context)(Scope.provide(scope)(effect)).then((registration) => ({
            dispose: () => Effect.runPromiseWith(context)(registration.dispose),
          }))

        const run = (effect: Effect.Effect<void>) => Effect.runPromiseWith(context)(effect)

        const transform =
          <Draft>(domain: {
            transform: (
              callback: (draft: Draft) => Effect.Effect<void> | void,
            ) => Effect.Effect<HostRegistration, never, Scope.Scope>
          }) =>
          (callback: (draft: Draft) => Promise<void> | void) =>
            register(domain.transform((draft) => Effect.promise(() => Promise.resolve(callback(draft)))))

        const context2: PluginContext = {
          options: host.options,
          hook: {
            agent: { transform: transform(host.hook.agent) },
            aisdk: {
              sdk: (callback) =>
                register(host.hook.aisdk.sdk((event) => Effect.promise(() => Promise.resolve(callback(event))))),
              language: (callback) =>
                register(host.hook.aisdk.language((event) => Effect.promise(() => Promise.resolve(callback(event))))),
            },
            catalog: { transform: transform(host.hook.catalog) },
            command: { transform: transform(host.hook.command) },
            integration: { transform: transform(host.hook.integration) },
            plugin: { transform: transform(host.hook.plugin) },
            reference: { transform: transform(host.hook.reference) },
            skill: { transform: transform(host.hook.skill) },
          },
          reload: {
            agent: () => run(host.reload.agent()),
            catalog: () => run(host.reload.catalog()),
            command: () => run(host.reload.command()),
            integration: () => run(host.reload.integration()),
            plugin: () => run(host.reload.plugin()),
            reference: () => run(host.reload.reference()),
            skill: () => run(host.reload.skill()),
          },
        }

        yield* Effect.promise(() => Promise.resolve(plugin.setup(context2)))
      }),
  })
}
