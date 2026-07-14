export * as PluginPromise from "./promise"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import type { Context, Plugin } from "@opencode-ai/plugin/v2/plugin"
import type { AnyTool } from "@opencode-ai/plugin/v2/tool"
import { Agent } from "@opencode-ai/schema/agent"
import { Integration } from "@opencode-ai/schema/integration"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Workspace } from "@opencode-ai/schema/workspace"
import { DateTime, Effect, Scope, Stream } from "effect"
import { Tool } from "../tool/tool"

type HostRegistration = { readonly dispose: Effect.Effect<void> }
type Registration = { readonly dispose: () => Promise<void> }
type PromiseEvent = ReturnType<Context["event"]["subscribe"]> extends AsyncIterable<infer Event> ? Event : never
type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

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

        const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect).then(wire)

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

        const context2: Context = {
          options: host.options,
          agent: {
            list: (input) => run(host.agent.list(input)),
            transform: transform(host.agent),
            reload: () => run(host.agent.reload()),
          },
          aisdk: {
            hook: (name, callback) =>
              register(host.aisdk.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
          catalog: {
            provider: {
              list: (input) => run(host.catalog.provider.list(input)),
              get: (input) => run(host.catalog.provider.get({ ...input, providerID: Provider.ID.make(input.providerID) })),
            },
            model: {
              list: (input) => run(host.catalog.model.list(input)),
              default: (input) =>
                run(host.catalog.model.default(input)).then((result) => ({ ...result, data: result.data ?? null })),
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
            subscribe: () => Stream.toAsyncIterable(host.event.subscribe().pipe(Stream.map(wireEvent))),
          },
          integration: {
            list: (input) => run(host.integration.list(input)),
            get: (input) =>
              run(host.integration.get({ ...input, integrationID: Integration.ID.make(input.integrationID) })).then(
                (result) => ({ ...result, data: result.data ?? null }),
              ),
            connect: {
              key: (input) =>
                run(host.integration.connect.key({ ...input, integrationID: Integration.ID.make(input.integrationID) })),
              oauth: (input) =>
                run(
                  host.integration.connect.oauth({
                    ...input,
                    integrationID: Integration.ID.make(input.integrationID),
                    methodID: Integration.MethodID.make(input.methodID),
                  }),
                ),
            },
            attempt: {
              status: (input) =>
                run(
                  host.integration.attempt.status({
                    ...input,
                    attemptID: Integration.AttemptID.make(input.attemptID),
                  }),
                ),
              complete: (input) =>
                run(
                  host.integration.attempt.complete({
                    ...input,
                    attemptID: Integration.AttemptID.make(input.attemptID),
                  }),
                ),
              cancel: (input) =>
                run(
                  host.integration.attempt.cancel({
                    ...input,
                    attemptID: Integration.AttemptID.make(input.attemptID),
                  }),
                ),
            },
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
          tool: {
            transform: (callback) =>
              register(
                host.tool.transform((draft) =>
                  callback({
                    add: (tool: AnyTool) => draft.add(tool.name, fromPromiseTool(tool), tool.options),
                  }),
                ),
              ),
            hook: (name, callback) =>
              register(host.tool.hook(name, (event) => Effect.promise(() => Promise.resolve(callback(event))))),
          },
          session: {
            create: (input) =>
              run(
                host.session.create(
                  input === undefined
                    ? undefined
                    : {
                        id: input.id == null ? undefined : Session.ID.make(input.id),
                        agent: input.agent == null ? undefined : Agent.ID.make(input.agent),
                        model: input.model == null ? undefined : model(input.model),
                        location:
                          input.location == null
                            ? undefined
                            : Location.Ref.make({
                                directory: AbsolutePath.make(input.location.directory),
                                workspaceID:
                                  input.location.workspaceID === undefined
                                    ? undefined
                                    : Workspace.ID.make(input.location.workspaceID),
                              }),
                      },
                ),
              ),
            get: (input) => run(host.session.get({ sessionID: Session.ID.make(input.sessionID) })),
            prompt: (input) =>
              run(
                host.session.prompt({
                  ...input,
                  sessionID: Session.ID.make(input.sessionID),
                  id: input.id == null ? undefined : SessionMessage.ID.make(input.id),
                  delivery: input.delivery ?? undefined,
                  resume: input.resume ?? undefined,
                }),
              ),
            command: (input) =>
              run(
                host.session.command({
                  ...input,
                  sessionID: Session.ID.make(input.sessionID),
                  id: input.id == null ? undefined : SessionMessage.ID.make(input.id),
                  agent: input.agent == null ? undefined : Agent.ID.make(input.agent),
                  model: input.model == null ? undefined : model(input.model),
                  arguments: input.arguments ?? undefined,
                  delivery: input.delivery ?? undefined,
                  resume: input.resume ?? undefined,
                }),
              ),
            interrupt: (input) => run(host.session.interrupt({ sessionID: Session.ID.make(input.sessionID) })),
          },
        }

        const cleanup = yield* Effect.promise(() => Promise.resolve(plugin.setup(context2)))
        if (!cleanup) return
        yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(cleanup())))
      }),
  })
}

function model(input: { readonly id: string; readonly providerID: string; readonly variant?: string }) {
  return Model.Ref.make({
    id: Model.ID.make(input.id),
    providerID: Provider.ID.make(input.providerID),
    variant: input.variant === undefined ? undefined : Model.VariantID.make(input.variant),
  })
}

type Wire<Value> = unknown extends Value
  ? JsonValue
  : Value extends string | number | boolean | bigint | symbol | null | undefined
    ? Value
    : Value extends DateTime.DateTime
      ? number
      : Value extends ReadonlyArray<infer Item>
        ? Array<Wire<Item>>
        : Value extends object
          ? { -readonly [Key in keyof Value]: Wire<Value[Key]> }
          : Value

function wire<Value>(value: Value): Wire<Value>
function wire(value: unknown): unknown {
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value)
  if (Array.isArray(value)) return value.map(wire)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)]))
}

function wireEvent(value: unknown): PromiseEvent
function wireEvent(value: unknown): unknown {
  return wire(value)
}

function fromPromiseTool(tool: AnyTool) {
  if ("jsonSchema" in tool)
    return Tool.make({
      ...tool,
      execute: (input, context) =>
        Effect.promise(() =>
          tool.execute(input, {
            ...context,
            progress: (update) => Effect.runPromise(context.progress(update)),
          }),
        ),
    })
  return Tool.make({
    ...tool,
    execute: (input, context) =>
      Effect.promise(() =>
        tool.execute(input, {
          ...context,
          progress: (update) => Effect.runPromise(context.progress(update)),
        }),
      ),
  })
}
