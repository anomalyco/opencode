export * as PluginPromise from "./promise"

import { define } from "@opencode-ai/plugin/v2/effect"
import type { Plugin, PluginContext } from "@opencode-ai/plugin/v2/promise"
import { Effect, Scope, Stream } from "effect"

type HostRegistration = { readonly dispose: Effect.Effect<void> }
type Registration = { readonly dispose: () => Promise<void> }

/**
 * Adapts a Promise plugin into an Effect plugin so the existing Effect-only
 * loader (`PluginV2` / `PluginSupervisor`) can run it unchanged.
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

        const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect)

        const transform =
          <Draft>(domain: {
            transform: (callback: (draft: Draft) => void) => Effect.Effect<HostRegistration, never, Scope.Scope>
          }) =>
          (callback: (draft: Draft) => void) =>
            register(
              domain.transform((draft) => {
                callback(draft)
              }),
            )

        const context2: PluginContext = {
          options: host.options,
          agent: {
            list: (input) => run(host.agent.list(input)),
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
            provider: {
              list: (input) => run(host.catalog.provider.list(input)),
              get: (input) => run(host.catalog.provider.get(input)),
            },
            model: {
              list: (input) => run(host.catalog.model.list(input)),
              default: (input) => run(host.catalog.model.default(input)),
            },
            transform: transform(host.catalog),
            reload: () => run(host.catalog.reload()),
          },
          command: {
            list: (input) => run(host.command.list(input)),
            transform: transform(host.command),
            reload: () => run(host.command.reload()),
          },
          event: {
            subscribe: () => Stream.toAsyncIterable(host.event.subscribe()),
          },
          integration: {
            list: (input) => run(host.integration.list(input)),
            get: (input) => run(host.integration.get(input)),
            connectKey: (input) => run(host.integration.connectKey(input)),
            connectOauth: (input) => run(host.integration.connectOauth(input)),
            attemptStatus: (input) => run(host.integration.attemptStatus(input)),
            attemptComplete: (input) => run(host.integration.attemptComplete(input)),
            attemptCancel: (input) => run(host.integration.attemptCancel(input)),
            transform: transform(host.integration),
            reload: () => run(host.integration.reload()),
            connection: {
              active: (id) => Effect.runPromiseWith(context)(host.integration.connection.active(id)),
              resolve: (connection) => Effect.runPromiseWith(context)(host.integration.connection.resolve(connection)),
            },
          },
          plugin: {
            list: (input) => run(host.plugin.list(input)),
          },
          reference: {
            list: (input) => run(host.reference.list(input)),
            transform: transform(host.reference),
            reload: () => run(host.reference.reload()),
          },
          skill: {
            list: (input) => run(host.skill.list(input)),
            transform: transform(host.skill),
            reload: () => run(host.skill.reload()),
          },
          session: {
            create: (input) => run(host.session.create(input)),
            get: (input) => run(host.session.get(input)),
            prompt: (input) => run(host.session.prompt(input)),
            command: (input) => run(host.session.command(input)),
            interrupt: (input) => run(host.session.interrupt(input)),
          },
        }

        yield* Effect.promise(() => Promise.resolve(plugin.setup(context2)))
      }),
  })
}
