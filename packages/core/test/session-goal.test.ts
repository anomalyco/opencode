import { describe, expect, beforeEach } from "bun:test"
import { Effect } from "effect"
import { SessionGoal } from "@opencode-ai/core/session/goal"
import { testEffect } from "./lib/effect"
import { Database } from "@opencode-ai/core/database/database"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { EventV2 } from "@opencode-ai/core/event"

const it = testEffect(
  Layer.mergeAll(SessionGoal.defaultLayer, Database.defaultLayer, EventV2.defaultLayer),
)

describe("SessionGoal", () => {
  const sessionID = SessionSchema.ID.make("test-session-123")

  beforeEach(async () => {
    const { db } = await Effect.runPromise(Database.defaultLayer.pipe(Effect.provide(Database.defaultLayer)))
    await db.delete(SessionTable).execute()
  })

  it.effect("set creates a new goal", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      yield* goal.set({ sessionID, condition: "All tests pass" })
      const result = yield* goal.get(sessionID)
      expect(result).toBeDefined()
      expect(result?.condition).toBe("All tests pass")
      expect(result?.status).toBe("active")
      expect(result?.iterations).toBe(0)
    }),
  )

  it.effect("set replaces existing goal", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      yield* goal.set({ sessionID, condition: "First goal" })
      yield* goal.set({ sessionID, condition: "Second goal" })
      const result = yield* goal.get(sessionID)
      expect(result?.condition).toBe("Second goal")
      expect(result?.iterations).toBe(0)
    }),
  )

  it.effect("get returns undefined for non-existent goal", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      const result = yield* goal.get(SessionSchema.ID.make("non-existent"))
      expect(result).toBeUndefined()
    }),
  )

  it.effect("clear removes the goal", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      yield* goal.set({ sessionID, condition: "Test goal" })
      yield* goal.clear(sessionID)
      const result = yield* goal.get(sessionID)
      expect(result).toBeUndefined()
    }),
  )

  it.effect("achieve updates status to achieved", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      yield* goal.set({ sessionID, condition: "Test goal" })
      yield* goal.achieve(sessionID, "Condition met")
      const result = yield* goal.get(sessionID)
      expect(result?.status).toBe("achieved")
      expect(result?.lastReason).toBe("Condition met")
    }),
  )

  it.effect("update increments iterations", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      yield* goal.set({ sessionID, condition: "Test goal" })
      yield* goal.update({ sessionID, iterations: 1 })
      const result = yield* goal.get(sessionID)
      expect(result?.iterations).toBe(1)
    }),
  )

  it.effect("update sets lastReason", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      yield* goal.set({ sessionID, condition: "Test goal" })
      yield* goal.update({ sessionID, lastReason: "Not yet" })
      const result = yield* goal.get(sessionID)
      expect(result?.lastReason).toBe("Not yet")
    }),
  )

  it.effect("set with evaluatorModel stores model config", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      yield* goal.set({
        sessionID,
        condition: "Test goal",
        evaluatorModel: { providerID: "anthropic", modelID: "claude-3-haiku" },
      })
      const result = yield* goal.get(sessionID)
      expect(result?.evaluatorModel).toEqual({
        providerID: "anthropic",
        modelID: "claude-3-haiku",
      })
    }),
  )
})
