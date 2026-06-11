export * as AgentV2 from "./agent"

import { Array, Context, Effect, Layer, Schema, Scope } from "effect"
import { castDraft, enableMapSet, type Draft } from "immer"
import { ModelV2 } from "./model"
import { PermissionSchema } from "./permission/schema"
import { ProviderV2 } from "./provider"
import { PositiveInt } from "./schema"
import { State } from "./state"

export const ID = Schema.String.pipe(Schema.brand("AgentV2.ID"))
export type ID = typeof ID.Type
export const defaultID = ID.make("build")

export const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
])

export class Info extends Schema.Class<Info>("AgentV2.Info")({
  id: ID,
  model: ModelV2.Ref.pipe(Schema.optional),
  request: ProviderV2.Request,
  system: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Color.pipe(Schema.optional),
  steps: PositiveInt.pipe(Schema.optional),
  permissions: PermissionSchema.Ruleset,
}) {
  static empty(id: ID) {
    return new Info({
      id,
      request: {
        headers: {},
        body: {},
      },
      mode: "all",
      hidden: false,
      permissions: [],
    })
  }
}

export interface Selection {
  readonly id: ID
  readonly info: Info | undefined
}

type Data = {
  agents: Map<ID, Info>
  default?: ID
}

export type Editor = {
  list: () => readonly Info[]
  get: (id: ID) => Info | undefined
  default: (id: ID | undefined) => void
  update: (id: ID, fn: (agent: Draft<Info>) => void) => void
  remove: (id: ID) => void
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly update: State.Interface<Data, Editor>["update"]
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly default: () => Effect.Effect<Info | undefined>
  readonly resolve: (id?: ID | string) => Effect.Effect<Info | undefined>
  readonly select: (id?: ID | string) => Effect.Effect<Selection>
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
        default: (id) => {
          draft.default = id
        },
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
    const selectable = (agent: Info | undefined) =>
      agent && agent.mode !== "subagent" && !agent.hidden ? agent : undefined
    const selectedDefault = () => {
      const data = state.get()
      const configured = data.default ? selectable(data.agents.get(data.default)) : undefined
      if (configured) return configured
      const build = selectable(data.agents.get(ID.make("build")))
      if (build) return build
      for (const agent of data.agents.values()) {
        const fallback = selectable(agent)
        if (fallback) return fallback
      }
    }

    return Service.of({
      transform: state.transform,
      update: state.update,
      get: Effect.fn("AgentV2.get")(function* (id) {
        return state.get().agents.get(id)
      }),
      default: Effect.fn("AgentV2.default")(function* () {
        return selectedDefault()
      }),
      resolve: Effect.fn("AgentV2.resolve")(function* (id) {
        if (id !== undefined) return state.get().agents.get(ID.make(id))
        return selectedDefault()
      }),
      select: Effect.fn("AgentV2.select")(function* (id) {
        if (id !== undefined) {
          const selected = ID.make(id)
          return { id: selected, info: state.get().agents.get(selected) }
        }
        const info = selectedDefault()
        return { id: info?.id ?? defaultID, info }
      }),
      all: Effect.fn("AgentV2.all")(function* () {
        return Array.fromIterable(state.get().agents.values())
      }),
    })
  }),
)

export const locationLayer = layer
