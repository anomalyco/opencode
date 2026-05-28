import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Context, Schema, Option } from "effect"
import { SessionID } from "./schema"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import * as Database from "@/storage/db"
import { eq } from "@/storage/db"
import { SessionTable } from "./session.sql"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.goal" })

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"])

export const GoalStatus = Schema.Literals(["active", "achieved", "cleared"])
export type GoalStatus = Schema.Schema.Type<typeof GoalStatus>

export const Goal = Schema.Struct({
  condition: Schema.String,
  status: GoalStatus,
  time: Schema.Struct({
    started: Schema.Number,
    ended: Schema.optional(Schema.Number),
  }),
  turns: Schema.Number,
  tokens: Schema.Number,
  lastReason: Schema.optional(Schema.String),
}).annotate({ identifier: "Goal" })
export type Goal = Schema.Schema.Type<typeof Goal>

export type EvalResult = { met: boolean; reason: string }

export const Event = {
  Set: BusEvent.define("session.goal.set", Schema.Struct({ sessionID: SessionID, goal: Goal })),
  Evaluated: BusEvent.define(
    "session.goal.evaluated",
    Schema.Struct({ sessionID: SessionID, met: Schema.Boolean, reason: Schema.String, turns: Schema.Number }),
  ),
  Cleared: BusEvent.define("session.goal.cleared", Schema.Struct({ sessionID: SessionID })),
}

export interface Interface {
  readonly set: (sessionID: SessionID, condition: string) => Effect.Effect<Goal>
  readonly get: (sessionID: SessionID) => Effect.Effect<Option.Option<Goal>>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
  readonly achieve: (sessionID: SessionID) => Effect.Effect<void>
  readonly afterTurn: (sessionID: SessionID, tokens: number) => Effect.Effect<void>
  readonly updateLastReason: (sessionID: SessionID, reason: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoal") {}

// ── DB helpers ──────────────────────────────────────────────────────────────
// Stryker disable all

function readGoal(sessionID: SessionID): Goal | undefined {
  const row = Database.use((db) =>
    db.select({ goal: SessionTable.goal }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  return row?.goal ?? undefined
}

function writeGoal(sessionID: SessionID, goal: Goal | null) {
  Database.use((db) =>
    db.update(SessionTable).set({ goal: goal ?? null }).where(eq(SessionTable.id, sessionID)).run(),
  )
}

// Stryker restore all

// ── Pure helpers (exported for testability) ──────────────────────────────────

/** Whether the argument to /goal is a "clear" alias rather than a new condition */
export function isClearAlias(arg: string): boolean {
  return CLEAR_ALIASES.has(arg.trim().toLowerCase())
}

/** Build the evaluator user-message from a condition and conversation transcript */
export function buildEvalPrompt(condition: string, transcript: string): string {
  return [
    `Goal condition: ${condition}`,
    "",
    "Conversation transcript:",
    transcript,
    "",
    "Is the goal condition fully met based on what the assistant has done and reported?",
  ].join("\n")
}

/** Extract a plain-text transcript from a message list */
export function extractTranscript(messages: Array<{ info: { role: string }; parts: Array<any> }>): string {
  const lines: string[] = []
  for (const msg of messages) {
    const role = msg.info.role === "user" ? "User" : "Assistant"
    for (const part of msg.parts) {
      if (part.type === "text" && !("synthetic" in part && part.synthetic)) {
        lines.push(`${role}: ${part.text}`)
      }
      if (part.type === "tool" && part.state?.status === "completed") {
        lines.push(`[Tool ${part.tool}: ${part.state.output?.slice(0, 200) ?? ""}]`)
      }
    }
  }
  return lines.join("\n")
}

/** Parse a two-line evaluator response into a result */
export function parseEvalResponse(text: string): EvalResult {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const first = (lines[0] ?? "").toLowerCase()
  const met = first === "yes" || first.startsWith("yes")
  const reason = lines[1] ?? lines[0] ?? "No reason provided"
  return { met, reason }
}

/** System prompt sent to the goal evaluator model */
export const EVAL_SYSTEM = `You are a goal evaluator. Given a goal condition and a conversation transcript, decide whether the condition is fully met.

Respond with exactly two lines:
Line 1: either "yes" or "no"
Line 2: a single sentence explaining why`

// Stryker disable all
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionGoal.state")(() => Effect.succeed(new Map<SessionID, Goal | null>())),
    )

    const loadGoal = Effect.fn("SessionGoal.loadGoal")(function* (sessionID: SessionID) {
      const cache = yield* InstanceState.get(state)
      if (cache.has(sessionID)) return cache.get(sessionID) ?? null
      const persisted = readGoal(sessionID)
      const value = persisted ?? null
      cache.set(sessionID, value)
      return value
    })

    const saveGoal = Effect.fn("SessionGoal.saveGoal")(function* (sessionID: SessionID, goal: Goal | null) {
      const cache = yield* InstanceState.get(state)
      cache.set(sessionID, goal)
      writeGoal(sessionID, goal)
    })

    const set = Effect.fn("SessionGoal.set")(function* (sessionID: SessionID, condition: string) {
      const goal: Goal = {
        condition,
        status: "active",
        time: { started: Date.now() },
        turns: 0,
        tokens: 0,
      }
      yield* saveGoal(sessionID, goal)
      yield* bus.publish(Event.Set, { sessionID, goal })
      log.info("goal set", { sessionID, condition })
      return goal
    })

    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionID) {
      const goal = yield* loadGoal(sessionID)
      return goal ? Option.some(goal) : Option.none()
    })

    const achieve = Effect.fn("SessionGoal.achieve")(function* (sessionID: SessionID) {
      const existing = yield* loadGoal(sessionID)
      if (!existing || existing.status !== "active") return
      const achieved: Goal = { ...existing, status: "achieved", time: { ...existing.time, ended: Date.now() } }
      yield* saveGoal(sessionID, achieved)
      log.info("goal achieved", { sessionID, condition: existing.condition })
    })

    const clear = Effect.fn("SessionGoal.clear")(function* (sessionID: SessionID) {
      const existing = yield* loadGoal(sessionID)
      if (!existing || existing.status !== "active") return
      const cleared: Goal = { ...existing, status: "cleared", time: { ...existing.time, ended: Date.now() } }
      yield* saveGoal(sessionID, cleared)
      yield* bus.publish(Event.Cleared, { sessionID })
      log.info("goal cleared", { sessionID })
    })

    const afterTurn = Effect.fn("SessionGoal.afterTurn")(function* (sessionID: SessionID, tokens: number) {
      const goal = yield* loadGoal(sessionID)
      if (!goal || goal.status !== "active") return
      yield* saveGoal(sessionID, { ...goal, turns: goal.turns + 1, tokens: goal.tokens + tokens })
    })

    const updateLastReason = Effect.fn("SessionGoal.updateLastReason")(function* (
      sessionID: SessionID,
      reason: string,
    ) {
      const goal = yield* loadGoal(sessionID)
      if (!goal || goal.status !== "active") return
      yield* saveGoal(sessionID, { ...goal, lastReason: reason })
    })

    return Service.of({ set, get, achieve, clear, afterTurn, updateLastReason })
  }),
)

// Stryker restore all
export const defaultLayer = Layer.suspend(() => layer.pipe(Layer.provide(Bus.layer)))

export * as SessionGoal from "./goal"
