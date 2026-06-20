import { SessionID } from "@/session/schema"
import { Effect, Context, Layer } from "effect"

export type Phase = "planning" | "building" | "verifying" | "iterating" | "complete"

const VALID_TRANSITIONS: Record<Phase, Phase[]> = {
  planning: ["building"],
  building: ["verifying"],
  verifying: ["iterating", "complete"],
  iterating: ["verifying"],
  complete: [],
}

const PHASE_TOOLS: Record<Phase, { allowed: string[]; blocked: string[] }> = {
  planning: {
    allowed: ["read", "glob", "grep", "list", "ultra_verify", "ultra_phase", "webfetch", "websearch"],
    blocked: ["edit", "write", "apply_patch", "shell"],
  },
  building: {
    allowed: ["*"],
    blocked: [],
  },
  verifying: {
    allowed: ["read", "glob", "grep", "list", "ultra_verify", "ultra_phase", "webfetch", "websearch"],
    blocked: ["edit", "write", "apply_patch", "shell"],
  },
  iterating: {
    allowed: ["read", "glob", "grep", "list", "webfetch", "websearch", "edit", "write", "apply_patch", "shell", "ultra_phase"],
    blocked: ["ultra_verify"],
  },
  complete: {
    allowed: ["read", "glob", "grep", "list"],
    blocked: ["edit", "write", "apply_patch", "shell", "ultra_verify", "ultra_phase"],
  },
}

const MAX_RETRIES = 10

export interface UltraState {
  readonly sessionID: SessionID
  phase: Phase
  retries: number
  planPath?: string
  verifyResult?: string
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<UltraState | undefined>
  readonly transition: (sessionID: SessionID, to: Phase) => Effect.Effect<void, Error>
  readonly incrementRetry: (sessionID: SessionID) => Effect.Effect<number>
  readonly isToolAllowed: (sessionID: SessionID, toolID: string) => Effect.Effect<boolean>
  readonly init: (sessionID: SessionID) => Effect.Effect<void>
  readonly reset: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UltraState") {}

export const use = Context.get(Service)

const states = new Map<string, UltraState>()

export const layer = Layer.succeed(Service, {
  get: (sessionID) =>
    Effect.sync(() => {
      return states.get(sessionID)
    }),

  init: (sessionID) =>
    Effect.sync(() => {
      states.set(sessionID, {
        sessionID,
        phase: "planning",
        retries: 0,
      })
    }),

  reset: (sessionID) =>
    Effect.sync(() => {
      states.delete(sessionID)
    }),

  transition: (sessionID, to) =>
    Effect.gen(function* () {
      const state = states.get(sessionID)
      if (!state) return yield* Effect.fail(new Error("Ultra state not initialized for session"))

      const allowed = VALID_TRANSITIONS[state.phase]
      if (!allowed.includes(to)) {
        return yield* Effect.fail(
          new Error(`Invalid transition: ${state.phase} → ${to}. Allowed: ${allowed.join(", ")}`),
        )
      }
      state.phase = to
    }),

  incrementRetry: (sessionID) =>
    Effect.gen(function* () {
      const state = states.get(sessionID)
      if (!state) return yield* Effect.fail(new Error("Ultra state not initialized for session"))
      state.retries++
      return state.retries
    }),

  isToolAllowed: (sessionID, toolID) =>
    Effect.gen(function* () {
      const state = states.get(sessionID)
      if (!state) return true
      const rules = PHASE_TOOLS[state.phase]
      if (rules.blocked.includes(toolID)) return false
      if (rules.allowed.includes("*")) return true
      return rules.allowed.includes(toolID)
    }),
})

export const maxRetries = MAX_RETRIES
