export * as ApplicationTools from "./application-tools"

import { Context, Effect, Layer, Scope } from "effect"
import { castDraft, enableMapSet } from "immer"
import { State } from "../state"
import { NativeTool } from "./native"

type Data = {
  readonly entries: Map<string, NativeTool.Any>
}

type Editor = {
  readonly set: (name: string, tool: NativeTool.Any) => void
}

export interface Interface {
  readonly attach: (tools: Readonly<Record<string, NativeTool.Any>>) => Effect.Effect<void, never, Scope.Scope>
  readonly entries: () => ReadonlyMap<string, NativeTool.Any>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ApplicationTools") {}

enableMapSet()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Data, Editor>({
      initial: () => ({ entries: new Map() }),
      editor: (draft) => ({
        set: (name, tool) => {
          draft.entries.set(
            name,
            castDraft(tool) as typeof draft.entries extends Map<string, infer Value> ? Value : never,
          )
        },
      }),
    })

    return Service.of({
      attach: Effect.fn("ApplicationTools.attach")(function* (tools) {
        const entries = Object.entries(tools)
        const transform = yield* state.transform()
        yield* transform((editor) => {
          for (const [name, tool] of entries) editor.set(name, tool)
        })
      }),
      entries: () => state.get().entries,
    })
  }),
)
