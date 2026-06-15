import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageV2 } from "@/session/message-v2"
import { SessionRunState } from "@/session/run-state"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

describe("SessionRunState", () => {
  it.instance("deduplicates concurrent runs across independently built layers", () =>
    Effect.gen(function* () {
      const leftContext = yield* Layer.build(Layer.fresh(SessionRunState.defaultLayer))
      const rightContext = yield* Layer.build(Layer.fresh(SessionRunState.defaultLayer))
      const left = Context.get(leftContext, SessionRunState.Service)
      const right = Context.get(rightContext, SessionRunState.Service)
      const calls = yield* Ref.make(0)
      const release = yield* Deferred.make<void>()
      const sessionID = SessionID.descending()

      const work = Effect.gen(function* () {
        yield* Ref.update(calls, (count) => count + 1)
        yield* Deferred.await(release)
        return {
          info: {
            id: MessageID.ascending("msg_shared"),
            role: "assistant" as const,
            parentID: MessageID.ascending("msg_parent"),
            sessionID,
            mode: "build",
            agent: "build",
            cost: 0,
            path: { cwd: "/tmp", root: "/tmp" },
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ModelID.make("test-model"),
            providerID: ProviderID.make("test"),
            time: { created: 0 },
          },
          parts: [],
        } satisfies MessageV2.WithParts
      })

      const first = yield* left.ensureRunning(sessionID, Effect.die("unexpected interrupt"), work).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const second = yield* right.ensureRunning(sessionID, Effect.die("unexpected interrupt"), work).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Ref.get(calls)).toBe(1)

      yield* Deferred.succeed(release, void 0)
      const [a, b] = yield* Effect.all([Fiber.join(first), Fiber.join(second)])

      expect(a).toEqual(b)
      expect(yield* Ref.get(calls)).toBe(1)
      yield* left.assertNotBusy(sessionID)
      yield* right.assertNotBusy(sessionID)
    }),
  )
})
