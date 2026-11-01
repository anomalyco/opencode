export * as SessionRunnerLoopState from "./loop-state.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { LOOP_NUDGE_CAP } from "../llm/reasoning-loop.js"
import { toolCallLoopDetector, toolLoopEnabled } from "../llm/tool-loop.js"
import { SessionSchema } from "../schema.js"

export interface Interface {
  /** Consumes one loop nudge for the turn, returning false once the cap is reached. */
  readonly takeNudge: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
  /** Feeds one tool call to the session's cross-step detector. */
  readonly recordToolCall: (sessionID: SessionSchema.ID, tool: string, input: unknown) => Effect.Effect<boolean>
  /** Forgets the turn's nudge count and tool-call history. */
  readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunnerLoopState") {}

type State = {
  nudges: number
  toolLoop: ReturnType<typeof toolCallLoopDetector>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const states = new Map<SessionSchema.ID, State>()
    const state = (sessionID: SessionSchema.ID) => {
      const current = states.get(sessionID)
      if (current) return current
      const created = { nudges: 0, toolLoop: toolCallLoopDetector() }
      states.set(sessionID, created)
      return created
    }

    return Service.of({
      takeNudge: (sessionID) =>
        Effect.sync(() => {
          const current = state(sessionID)
          if (current.nudges >= LOOP_NUDGE_CAP) return false
          current.nudges++
          return true
        }),
      recordToolCall: (sessionID, tool, input) =>
        Effect.sync(() => {
          if (!toolLoopEnabled()) return false
          return state(sessionID).toolLoop.feed(tool, input)
        }),
      clear: (sessionID) =>
        Effect.sync(() => {
          states.delete(sessionID)
        }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
