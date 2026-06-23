export * as PluginPromise from "./promise"

import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin, PluginContext, Registration } from "@opencode-ai/plugin/v2/promise"
import { Effect, Scope } from "effect"

// The Effect host hands back this registration shape; mirror it structurally so
// we do not have to alias the Effect package's `Registration` against the Promise one.
type HostRegistration = { readonly dispose: Effect.Effect<void> }

/**
 * Adapts a Promise plugin into an Effect plugin so the existing Effect-only
 * loader (`PluginV2` / `PluginInternal`) can run it unchanged.
 *
 * Hook registrations created during the async `setup` attach to the plugin's
 * scope, so unloading the plugin disposes them. The captured fiber context
 * preserves boot-time batching, so Promise-plugin transforms still coalesce
 * into one reload per domain.
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
          agent: {
            transform: transform(host.agent),
            reload: () => run(host.agent.reload()),
          },
          aisdk: {
            sdk: (callback) =>
              register(host.aisdk.sdk((event) => Effect.promise(() => Promise.resolve(callback(event))))),
            language: (callback) =>
              register(host.aisdk.language((event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
          catalog: {
            transform: transform(host.catalog),
            reload: () => run(host.catalog.reload()),
          },
          command: {
            transform: transform(host.command),
            reload: () => run(host.command.reload()),
          },
          integration: {
            transform: transform(host.integration),
            reload: () => run(host.integration.reload()),
          },
          plugin: {
            add: (input) => {
              const child = fromPromise(input)
              return run(host.plugin.add(child))
            },
            remove: (id) => run(host.plugin.remove(id)),
          },
          reference: {
            transform: transform(host.reference),
            reload: () => run(host.reference.reload()),
          },
          skill: {
            transform: transform(host.skill),
            reload: () => run(host.skill.reload()),
          },
        }

        yield* Effect.promise(() => Promise.resolve(plugin.setup(context2)))
      }),
  })
}
