export * as AgentV2 from "./agent"

import { Array, Context, Effect, Layer, Schema, Scope } from "effect"
import { castDraft, enableMapSet, type Draft } from "immer"
import { ModelV2 } from "./model"
import { PermissionV2 } from "./permission"
import { ProviderV2 } from "./provider"
import { PositiveInt } from "./schema"
import { State } from "./state"

export const ID = Schema.String.pipe(Schema.brand("AgentV2.ID"))
export type ID = typeof ID.Type

export const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
])

export class Info extends Schema.Class<Info>("AgentV2.Info")({
  id: ID,
  model: ModelV2.Ref.pipe(Schema.optional),
  options: ProviderV2.Options,
  system: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Color.pipe(Schema.optional),
  steps: PositiveInt.pipe(Schema.optional),
  permissions: PermissionV2.Ruleset,
}) {
  static empty(id: ID) {
    return new Info({
      id,
      options: {
        headers: {},
        body: {},
        aisdk: {
          provider: {},
          request: {},
        },
      },
      mode: "all",
      hidden: false,
      permissions: [],
    })
  }
}

type Data = {
  agents: Map<ID, Info>
}

export type Editor = {
  list: () => readonly Info[]
  get: (id: ID) => Info | undefined
  update: (id: ID, fn: (agent: Draft<Info>) => void) => void
  remove: (id: ID) => void
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly update: (update: State.Transform<Editor>) => Effect.Effect<void, never, Scope.Scope>
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Agent") {}

enableMapSet()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Data, Editor>({
      initial: () => ({ agents: new Map() }),
      editor: (draft) => ({
        list: () => Array.fromIterable(draft.agents.values()) as Info[],
        get: (id) => draft.agents.get(id),
        update: (id, fn) => {
          const current = draft.agents.get(id) ?? castDraft(Info.empty(id))
          if (!draft.agents.has(id)) draft.agents.set(id, current)
          fn(current)
          current.id = id
        },
        remove: (id) => {
          draft.agents.delete(id)
        },
      }),
    })

    return Service.of({
      transform: state.transform,
      update: Effect.fn("AgentV2.update")(function* (update) {
        const transform = yield* state.transform()
        yield* transform(update)
      }),
      get: Effect.fn("AgentV2.get")(function* (id) {
        return state.get().agents.get(id)
      }),
      all: Effect.fn("AgentV2.all")(function* () {
        return Array.fromIterable(state.get().agents.values())
      }),
    })
  }),
)

export const defaultLayer = layer
