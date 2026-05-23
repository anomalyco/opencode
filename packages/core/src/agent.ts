export * as AgentV2 from "./agent"

import { Context, Effect, HashMap, Layer, Option, Order, pipe, Schema, Array } from "effect"
import { produce, type Draft } from "immer"
import { ModelV2 } from "./model"
import { PermissionV2 } from "./permission"
import { PluginV2 } from "./plugin"
import { ProviderV2 } from "./provider"

export const ID = Schema.String.pipe(Schema.brand("AgentV2.ID"))
export type ID = typeof ID.Type

export const Mode = Schema.Literals(["subagent", "primary", "all"]).annotate({ identifier: "AgentV2.Mode" })
export type Mode = typeof Mode.Type

export const Info = Schema.Struct({
  name: ID,
  description: Schema.optional(Schema.String),
  mode: Mode,
  hidden: Schema.Boolean.pipe(Schema.optional),
  color: Schema.String.pipe(Schema.optional),
  permission: PermissionV2.Ruleset,
  model: ModelV2.Ref.pipe(Schema.optional),
  system: Schema.String.pipe(Schema.optional),
  options: ProviderV2.Options.pipe(Schema.optional),
  steps: Schema.Int.pipe(Schema.optional),
}).annotate({ identifier: "AgentV2.Info" })
export type Info = typeof Info.Type

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("AgentV2.NotFound", {
  agent: ID,
}) {}

export class InvalidDefaultError extends Schema.TaggedErrorClass<InvalidDefaultError>()("AgentV2.InvalidDefault", {
  agent: ID,
  reason: Schema.Literals(["missing", "subagent", "hidden"]),
}) {}

export class NoDefaultError extends Schema.TaggedErrorClass<NoDefaultError>()("AgentV2.NoDefault", {}) {}

export interface Interface {
  readonly get: (agent: ID) => Effect.Effect<Info, NotFoundError>
  readonly list: () => Effect.Effect<Info[]>
  readonly update: (agent: ID, fn: (agent: Draft<Info>) => void) => Effect.Effect<void>
  readonly remove: (agent: ID) => Effect.Effect<void>
  readonly defaultInfo: () => Effect.Effect<Info, InvalidDefaultError | NoDefaultError>
  readonly defaultAgent: () => Effect.Effect<ID, InvalidDefaultError | NoDefaultError>
  readonly setDefault: (agent: ID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Agent") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const plugin = yield* PluginV2.Service
    let agents = HashMap.empty<ID, Info>()
    let defaultAgent: ID | undefined

    const result: Interface = {
      get: Effect.fn("AgentV2.get")(function* (agent) {
        const match = HashMap.get(agents, agent)
        if (!match.valueOrUndefined) return yield* new NotFoundError({ agent })
        return match.value
      }),

      list: Effect.fn("AgentV2.list")(function* () {
        return pipe(
          HashMap.toValues(agents),
          Array.sortWith((agent) => agent.name, Order.String),
        )
      }),

      update: Effect.fnUntraced(function* (agent, fn) {
        const next = produce(
          HashMap.get(agents, agent).pipe(
            Option.getOrElse(
              () =>
                ({
                  name: agent,
                  mode: "all",
                  permission: [],
                  options: {
                    headers: {},
                    body: {},
                    aisdk: {
                      provider: {},
                      request: {},
                    },
                  },
                }) satisfies Info,
            ),
          ),
          fn,
        )
        const updated = yield* plugin.trigger("agent.update", {}, { agent: next, cancel: false })
        if (updated.cancel) return
        agents = HashMap.set(agents, agent, { ...updated.agent, name: agent })
      }),

      remove: Effect.fn("AgentV2.remove")(function* (agent) {
        const existing = Option.getOrUndefined(HashMap.get(agents, agent))
        if (!existing) return
        if ((yield* plugin.trigger("agent.remove", { agent: existing }, { cancel: false })).cancel) return
        agents = HashMap.remove(agents, agent)
        if (defaultAgent === agent) defaultAgent = undefined
      }),

      defaultInfo: Effect.fn("AgentV2.defaultInfo")(function* () {
        const updated = yield* plugin.trigger("agent.default", {}, { agent: defaultAgent })
        const selected = updated.agent
        if (selected) {
          const agent = yield* result
            .get(selected)
            .pipe(
              Effect.catchTag("AgentV2.NotFound", () =>
                Effect.fail(new InvalidDefaultError({ agent: selected, reason: "missing" })),
              ),
            )
          if (agent.mode === "subagent") return yield* new InvalidDefaultError({ agent: selected, reason: "subagent" })
          if (agent.hidden === true) return yield* new InvalidDefaultError({ agent: selected, reason: "hidden" })
          return agent
        }

        const visible = pipe(
          yield* result.list(),
          Array.findFirst((agent) => agent.mode !== "subagent" && agent.hidden !== true),
        )
        if (Option.isSome(visible)) return visible.value
        return yield* new NoDefaultError()
      }),

      defaultAgent: Effect.fn("AgentV2.defaultAgent")(function* () {
        return (yield* result.defaultInfo()).name
      }),

      setDefault: Effect.fn("AgentV2.setDefault")(function* (agent) {
        yield* result.get(agent)
        defaultAgent = agent
      }),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(PluginV2.defaultLayer))
