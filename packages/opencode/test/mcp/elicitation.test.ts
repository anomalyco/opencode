import { afterEach, expect } from "bun:test"
import { Effect, Fiber, Layer, Queue } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { McpElicitation } from "../../src/mcp/elicitation"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    McpElicitation.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer)),
    CrossSpawnSpawner.defaultLayer,
  ),
)

const booleanSchema = {
  type: "object",
  properties: {
    allowed: {
      type: "boolean",
      title: "Allow command",
      description: "Run the resolved command once",
    },
  },
  required: ["allowed"],
} as const

const askEffect = Effect.fn("McpElicitationTest.ask")(function* (server = "unity-gateway") {
  const elicitation = yield* McpElicitation.Service
  return yield* elicitation.ask({
    server,
    message: "Approve resolved Unity command?",
    schema: booleanSchema,
  })
})

const waitForPending = Effect.fn("McpElicitationTest.waitForPending")(function* (count: number) {
  const elicitation = yield* McpElicitation.Service
  const events = yield* EventV2Bridge.Service
  const asked = yield* Queue.unbounded<void>()
  const off = yield* events.listen((event) => {
    if (event.type === McpElicitation.Event.Asked.type) Queue.offerUnsafe(asked, undefined)
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  for (;;) {
    const pending = yield* elicitation.list()
    if (pending.length === count) return pending
    yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
  }
})

const waitForReply = Effect.fn("McpElicitationTest.waitForReply")(function* () {
  const events = yield* EventV2Bridge.Service
  const replied = yield* Queue.unbounded<{ requestID: McpElicitation.ID; result: McpElicitation.Result }>()
  const off = yield* events.listen((event) => {
    if (event.type === McpElicitation.Event.Replied.type) {
      Queue.offerUnsafe(replied, event.data as { requestID: McpElicitation.ID; result: McpElicitation.Result })
    }
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  return yield* Queue.take(replied).pipe(Effect.timeout("2 seconds"))
})

afterEach(async () => {
  await disposeAllInstances()
})

it.instance(
  "ask - publishes a pending MCP elicitation request",
  () =>
    Effect.gen(function* () {
      const fiber = yield* askEffect().pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)
      expect(pending).toEqual([
        expect.objectContaining({
          server: "unity-gateway",
          message: "Approve resolved Unity command?",
          schema: booleanSchema,
        }),
      ])

      const elicitation = yield* McpElicitation.Service
      yield* elicitation.cancel(pending[0].id)
      expect((yield* Fiber.await(fiber))._tag).toBe("Success")
    }),
  { git: true },
)

it.instance(
  "ask - publishes cancelled reply when interrupted",
  () =>
    Effect.gen(function* () {
      const reply = yield* waitForReply().pipe(Effect.forkScoped)
      const fiber = yield* askEffect().pipe(Effect.forkScoped)
      const [request] = yield* waitForPending(1)

      yield* Fiber.interrupt(fiber)

      expect(yield* Fiber.join(reply)).toEqual({
        requestID: request.id,
        result: { action: "cancel" },
      })

      const elicitation = yield* McpElicitation.Service
      expect(yield* elicitation.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "cancelServer - cancels pending requests for the server",
  () =>
    Effect.gen(function* () {
      const firstReply = yield* waitForReply().pipe(Effect.forkScoped)
      const first = yield* askEffect("unity-gateway").pipe(Effect.forkScoped)
      const second = yield* askEffect("other-server").pipe(Effect.forkScoped)
      const pending = yield* waitForPending(2)

      const elicitation = yield* McpElicitation.Service
      yield* elicitation.cancelServer("unity-gateway")

      const cancelled = yield* Fiber.join(firstReply)
      expect(cancelled.result).toEqual({ action: "cancel" })
      expect(pending.find((item) => item.id === cancelled.requestID)?.server).toBe("unity-gateway")
      expect(yield* Fiber.join(first)).toEqual({ action: "cancel" })
      expect(yield* elicitation.list()).toEqual([expect.objectContaining({ server: "other-server" })])

      const [remaining] = yield* elicitation.list()
      yield* elicitation.cancel(remaining.id)
      expect(yield* Fiber.join(second)).toEqual({ action: "cancel" })
    }),
  { git: true },
)

it.instance(
  "reply - resolves the pending request with accepted content",
  () =>
    Effect.gen(function* () {
      const fiber = yield* askEffect().pipe(Effect.forkScoped)
      const [request] = yield* waitForPending(1)

      const elicitation = yield* McpElicitation.Service
      yield* elicitation.reply({
        requestID: request.id,
        content: { allowed: true },
      })

      expect(yield* Fiber.join(fiber)).toEqual({
        action: "accept",
        content: { allowed: true },
      })
      expect(yield* elicitation.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "decline - resolves the pending request as declined",
  () =>
    Effect.gen(function* () {
      const fiber = yield* askEffect().pipe(Effect.forkScoped)
      const [request] = yield* waitForPending(1)

      const elicitation = yield* McpElicitation.Service
      yield* elicitation.decline(request.id)

      expect(yield* Fiber.join(fiber)).toEqual({ action: "decline" })
      expect(yield* elicitation.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "cancel - resolves the pending request as cancelled",
  () =>
    Effect.gen(function* () {
      const fiber = yield* askEffect().pipe(Effect.forkScoped)
      const [request] = yield* waitForPending(1)

      const elicitation = yield* McpElicitation.Service
      yield* elicitation.cancel(request.id)

      expect(yield* Fiber.join(fiber)).toEqual({ action: "cancel" })
      expect(yield* elicitation.list()).toEqual([])
    }),
  { git: true },
)
