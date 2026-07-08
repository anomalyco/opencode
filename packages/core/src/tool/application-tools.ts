export * as ApplicationTools from "./application-tools"

import { Context, Effect, Layer, Scope } from "effect"
import { State } from "../state"
import { Tool } from "./tool"
import { makeGlobalNode } from "../effect/app-node"

type Data = {
  readonly entries: Map<string, Entry>
}

type Draft = {
  readonly set: (name: string, entry: Entry) => void
  readonly remove: (name: string) => void
}

export interface Entry {
  readonly identity: object
  readonly tool: Tool.AnyTool
}

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  readonly remove: (...names: string[]) => Effect.Effect<void>
  readonly entries: () => ReadonlyMap<string, Entry>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ApplicationTools") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Data, Draft>({
      initial: () => ({ entries: new Map() }),
      draft: (draft) => ({
        set: (name, tool) => {
          draft.entries.set(name, tool)
        },
        remove: (name) => {
          draft.entries.delete(name)
        },
      }),
    })

    return Service.of({
      register: Effect.fn("ApplicationTools.register")(function* (tools) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => Tool.validateName(name), { discard: true })
        const registrations = entries.map(([name, tool]) => [name, { identity: {}, tool }] as const)
        yield* state.transform((draft) => {
          for (const [name, entry] of registrations) draft.set(name, entry)
        })
      }),
      remove: Effect.fn("ApplicationTools.remove")(function* (...names) {
        if (names.length === 0) return
        yield* state.transform((draft) => {
          for (const name of names) draft.remove(name)
        })
      }),
      entries: () => state.get().entries,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
