import { describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import { Goal } from "@/session/goal"
import type { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

// `it.instance` provides a tmpdir instance context (InstanceRef) so sessions —
// and the goals FK-bound to them — can be created.
const it = testEffect(Layer.mergeAll(Goal.defaultLayer, SessionNs.defaultLayer, Database.defaultLayer))

// Goals are FK-bound to a session, so each case runs against a fresh session.
const withGoal = <A, E, R>(fn: (input: { goals: Goal.Interface; sessionID: SessionID }) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const goals = yield* Goal.Service
      const created = yield* session.create({})
      return { session, goals, sessionID: created.id }
    }),
    ({ goals, sessionID }) => fn({ goals, sessionID }),
    ({ session, sessionID }) => session.remove(sessionID).pipe(Effect.ignore),
  )

describe("Goal", () => {
  it.instance("set creates an active goal and get returns it", () =>
    withGoal(({ goals, sessionID }) =>
      Effect.gen(function* () {
        const set = yield* goals.set({ sessionID, text: "ship the feature", budgetTokens: 1000 })
        expect(set.status).toBe("active")
        expect(set.text).toBe("ship the feature")
        expect(set.budgetTokens).toBe(1000)
        expect(set.tokensUsed).toBe(0)

        const got = yield* goals.get(sessionID)
        expect(got?.text).toBe("ship the feature")
        expect(got?.status).toBe("active")
      }),
    ),
  )

  it.instance("update changes text while staying active", () =>
    withGoal(({ goals, sessionID }) =>
      Effect.gen(function* () {
        yield* goals.set({ sessionID, text: "first" })
        const updated = yield* goals.update({ sessionID, text: "second" })
        expect(updated?.text).toBe("second")
        expect(updated?.status).toBe("active")
      }),
    ),
  )

  it.instance("pause and resume toggle status and pausedAt", () =>
    withGoal(({ goals, sessionID }) =>
      Effect.gen(function* () {
        yield* goals.set({ sessionID, text: "work" })
        const paused = yield* goals.pause(sessionID)
        expect(paused?.status).toBe("paused")
        expect(paused?.pausedAt).toBeDefined()

        const resumed = yield* goals.resume(sessionID)
        expect(resumed?.status).toBe("active")
        expect(resumed?.pausedAt).toBeUndefined()
      }),
    ),
  )

  it.instance("complete sets status, completedAt, and verification", () =>
    withGoal(({ goals, sessionID }) =>
      Effect.gen(function* () {
        yield* goals.set({ sessionID, text: "work" })
        const done = yield* goals.update({ sessionID, status: "completed", verification: "all tests pass" })
        expect(done?.status).toBe("completed")
        expect(done?.completedAt).toBeDefined()
        expect(done?.verification).toBe("all tests pass")
      }),
    ),
  )

  it.instance("recordUsage accumulates only while active", () =>
    withGoal(({ goals, sessionID }) =>
      Effect.gen(function* () {
        yield* goals.set({ sessionID, text: "work" })
        yield* goals.recordUsage({ sessionID, tokens: 50, durationMs: 100 })
        yield* goals.recordUsage({ sessionID, tokens: 25, durationMs: 40 })
        const active = yield* goals.get(sessionID)
        expect(active?.tokensUsed).toBe(75)
        expect(active?.timeMs).toBe(140)

        // Once completed, usage is no longer accumulated.
        yield* goals.update({ sessionID, status: "completed" })
        yield* goals.recordUsage({ sessionID, tokens: 1000, durationMs: 1000 })
        const completed = yield* goals.get(sessionID)
        expect(completed?.tokensUsed).toBe(75)
      }),
    ),
  )

  it.instance("clear removes the goal", () =>
    withGoal(({ goals, sessionID }) =>
      Effect.gen(function* () {
        yield* goals.set({ sessionID, text: "work" })
        yield* goals.clear(sessionID)
        expect(yield* goals.get(sessionID)).toBeUndefined()
      }),
    ),
  )

  it.instance("update on a session without a goal returns undefined", () =>
    withGoal(({ goals, sessionID }) =>
      Effect.gen(function* () {
        expect(yield* goals.update({ sessionID, text: "nope" })).toBeUndefined()
      }),
    ),
  )
})
