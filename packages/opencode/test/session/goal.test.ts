import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { SessionGoal } from "@/session/goal"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { testEffect } from "../lib/effect"
import { testInstanceStoreLayer, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const mockProviderLayer = Layer.mock(Provider.Service, {
  getLanguage: () => Effect.die(new Error("not implemented")),
  getModel: () => Effect.die(new Error("not implemented")),
  getSmallModel: () => Effect.die(new Error("not implemented")),
  list: () => Effect.succeed({}),
})

const mockAuthLayer = Layer.mock(Auth.Service, {
  get: () => Effect.succeed(undefined),
})

const goalTestLayer = Layer.mergeAll(
  SessionGoal.layer.pipe(
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(mockProviderLayer),
    Layer.provide(mockAuthLayer),
  ),
  testInstanceStoreLayer,
  CrossSpawnSpawner.defaultLayer,
)

const it = testEffect(goalTestLayer)

const sid = SessionID.make("ses_test-1")

describe("SessionGoal.Service", () => {
  it.live("set and get a goal", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        yield* goal.set(sid, "all tests pass")
        return yield* goal.get(sid)
      }).pipe(provideInstance(dir))
      expect(result).toEqual({ condition: "all tests pass", react: 0 })
    }),
  )

  it.live("get returns undefined when no goal set", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        return yield* goal.get(sid)
      }).pipe(provideInstance(dir))
      expect(result).toBeUndefined()
    }),
  )

  it.live("clear removes a goal", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        yield* goal.set(sid, "fix the bug")
        yield* goal.clear(sid)
        return yield* goal.get(sid)
      }).pipe(provideInstance(dir))
      expect(result).toBeUndefined()
    }),
  )

  it.live("clear is idempotent when no goal exists", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        yield* goal.clear(sid)
        return yield* goal.get(sid)
      }).pipe(provideInstance(dir))
      expect(result).toBeUndefined()
    }),
  )

  it.live("bumpReact increments react counter", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        yield* goal.set(sid, "ship it")
        const r1 = yield* goal.bumpReact(sid)
        expect(r1).toBe(1)
        const r2 = yield* goal.bumpReact(sid)
        expect(r2).toBe(2)
        const r3 = yield* goal.bumpReact(sid)
        expect(r3).toBe(3)
        const g = yield* goal.get(sid)
        expect(g?.react).toBe(3)
      }).pipe(provideInstance(dir))
    }),
  )

  it.live("bumpReact returns 0 when no goal exists", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        return yield* goal.bumpReact(sid)
      }).pipe(provideInstance(dir))
      expect(result).toBe(0)
    }),
  )

  it.live("set replaces existing goal and resets react", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        yield* goal.set(sid, "first goal")
        yield* goal.bumpReact(sid)
        yield* goal.bumpReact(sid)
        yield* goal.set(sid, "second goal")
        const g = yield* goal.get(sid)
        expect(g?.condition).toBe("second goal")
        expect(g?.react).toBe(0)
      }).pipe(provideInstance(dir))
    }),
  )

  it.live("goals are isolated per session", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        const sid2 = SessionID.make("ses_test-2")
        yield* goal.set(sid, "goal for session 1")
        yield* goal.set(sid2, "goal for session 2")
        const g1 = yield* goal.get(sid)
        const g2 = yield* goal.get(sid2)
        expect(g1?.condition).toBe("goal for session 1")
        expect(g2?.condition).toBe("goal for session 2")
        yield* goal.clear(sid)
        const g1After = yield* goal.get(sid)
        const g2After = yield* goal.get(sid2)
        expect(g1After).toBeUndefined()
        expect(g2After?.condition).toBe("goal for session 2")
      }).pipe(provideInstance(dir))
    }),
  )
})

describe("SessionGoal types", () => {
  test("Verdict schema decodes ok verdict", () => {
    const result = Schema.decodeUnknownSync(SessionGoal.Verdict)({ ok: true, reason: "done" })
    expect(result).toEqual({ ok: true, reason: "done" })
  })

  test("Verdict schema decodes impossible verdict", () => {
    const result = Schema.decodeUnknownSync(SessionGoal.Verdict)({ ok: false, impossible: true, reason: "cannot be done" })
    expect(result).toEqual({ ok: false, impossible: true, reason: "cannot be done" })
  })

  test("MAX_GOAL_REACT is 12", () => {
    expect(SessionGoal.MAX_GOAL_REACT).toBe(12)
  })
})
