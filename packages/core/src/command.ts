export * as CommandV2 from "./command"

import { Context, Effect, Layer, Schema } from "effect"
import { castDraft, type Draft } from "immer"
import { ModelV2 } from "./model"
import { State } from "./state"

export class Info extends Schema.Class<Info>("CommandV2.Info")({
  name: Schema.String,
  template: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  model: ModelV2.Ref.pipe(Schema.optional),
  subtask: Schema.Boolean.pipe(Schema.optional),
}) {}

export type Data = {
  commands: Map<string, Info>
}

export type Editor = {
  list: () => readonly Info[]
  get: (name: string) => Info | undefined
  update: (name: string, update: (command: Draft<Info>) => void) => void
  remove: (name: string) => void
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly update: State.Interface<Data, Editor>["update"]
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Command") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const state = State.create<Data, Editor>({
      initial: () => ({ commands: new Map() }),
      editor: (draft) => ({
        list: () => Array.from(draft.commands.values()) as Info[],
        get: (name) => draft.commands.get(name),
        update: (name, update) => {
          const current = draft.commands.get(name) ?? castDraft(new Info({ name, template: "" }))
          if (!draft.commands.has(name)) draft.commands.set(name, current)
          update(current)
          current.name = name
        },
        remove: (name) => {
          draft.commands.delete(name)
        },
      }),
    })

    return Service.of({
      update: state.update,
      transform: state.transform,
      get: Effect.fn("CommandV2.get")(function* (name) {
        return state.get().commands.get(name)
      }),
      list: Effect.fn("CommandV2.list")(function* () {
        return Array.from(state.get().commands.values())
      }),
    })
  }),
)

export const locationLayer = layer
