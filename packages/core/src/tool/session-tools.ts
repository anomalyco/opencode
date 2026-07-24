export * as SessionTools from "./session-tools"

import { Context, Effect, Layer, Scope } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "../session/schema"
import { State } from "../state"
import { Tool } from "./tool"

export interface Entry {
  readonly identity: object
  readonly tool: Tool.AnyTool
}

type Data = {
  readonly sessions: Map<SessionSchema.ID, Map<string, Entry>>
}

type Draft = {
  readonly set: (sessionID: SessionSchema.ID, name: string, entry: Entry) => void
}

export interface Interface {
  readonly register: (
    sessionID: SessionSchema.ID,
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  readonly entries: (sessionID: SessionSchema.ID) => ReadonlyMap<string, Entry>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTools") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Data, Draft>({
      initial: () => ({ sessions: new Map() }),
      draft: (draft) => ({
        set: (sessionID, name, entry) => {
          const entries = draft.sessions.get(sessionID) ?? new Map()
          entries.set(name, entry)
          draft.sessions.set(sessionID, entries)
        },
      }),
    })

    return Service.of({
      register: Effect.fn("SessionTools.register")(function* (sessionID, tools) {
        const registrations = Object.entries(tools).map(([name, tool]) => [name, { identity: {}, tool }] as const)
        if (registrations.length === 0) return
        yield* Effect.forEach(registrations, ([name]) => Tool.validateName(name), { discard: true })
        yield* state.transform((draft) => {
          for (const [name, entry] of registrations) draft.set(sessionID, name, entry)
        })
      }),
      entries: (sessionID) => state.get().sessions.get(sessionID) ?? new Map(),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
