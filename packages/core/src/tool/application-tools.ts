export * as ApplicationTools from "./application-tools"

import { Context, Effect, Layer, Scope } from "effect"
import { enableMapSet } from "immer"
import { State } from "../state"
import { Tool } from "./tool"

type Data = {
  readonly entries: Map<string, Entry>
}

type Editor = {
  readonly set: (name: string, entry: Entry) => void
}

export interface Entry {
  readonly identity: object
  readonly tool: Tool.AnyTool
}

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  readonly entries: () => ReadonlyMap<string, Entry>
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
          draft.entries.set(name, tool)
        },
      }),
    })

    return Service.of({
      register: Effect.fn("ApplicationTools.register")(function* (tools) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => Tool.validateName(name), { discard: true })
        const registrations = entries.map(([name, tool]) => [name, { identity: {}, tool }] as const)
        const transform = yield* state.transform()
        yield* transform((editor) => {
          for (const [name, entry] of registrations) editor.set(name, entry)
        })
      }),
      entries: () => state.get().entries,
    })
  }),
)
