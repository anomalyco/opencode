import { expect } from "bun:test"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { EffectBridge } from "../../src/effect/bridge"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const env = AppNodeBuilder.build(
  LayerNode.group([Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
  [[InstanceStore.bootstrapNode, Layer.mock(InstanceBootstrap.Service, { run: Effect.void })]],
)
const it = testEffect(env)
const input = {
  id: PermissionV1.ID.make("per_cancel"),
  sessionID: SessionID.make("ses_cancel"),
  permission: "bash",
  patterns: ["touch marker"],
  metadata: {},
  always: ["*"],
  ruleset: [],
} satisfies PermissionV1.AskInput

function observe(block = false, name = "bash", id = input.id) {
  return Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const asked = yield* Deferred.make<void>()
    const waiting = yield* Deferred.make<void>()
    const replies: unknown[] = []
    const unsubscribe = yield* events.listen((event) => {
      if (event.type === Permission.Event.Replied.type) replies.push(event.data)
      if (event.type !== Permission.Event.Asked.type) return Effect.void
      const request = Schema.decodeUnknownSync(Permission.Event.Asked.data)(event.data)
      if (request.id !== id || request.permission !== name) return Effect.void
      return Deferred.succeed(asked, undefined).pipe(Effect.andThen(block ? Deferred.await(waiting) : Effect.void))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    return { asked, replies }
  })
}

for (const block of [false, true]) {
  it.instance(`interruption settles permission while ${block ? "publishing Asked" : "waiting for reply"}`, () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const seen = yield* observe(block)
      const effects: string[] = []
      const fiber = yield* permission
        .ask(input)
        .pipe(Effect.andThen(Effect.sync(() => effects.push("executed"))), Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(seen.asked), "permission was not asked")
      yield* awaitWithTimeout(Fiber.interrupt(fiber), "permission interruption did not finish")
      expect(yield* permission.list()).toEqual([])
      expect(seen.replies).toEqual([{ sessionID: input.sessionID, requestID: input.id, reply: "reject" }])
      expect(yield* permission.reply({ requestID: input.id, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
        PermissionV1.NotFoundError,
      )
      expect(effects).toEqual([])
    }),
  )
}

for (const reply of ["once", "always", "reject"] as const) {
  it.instance(`normal ${reply} reply settles permission exactly once`, () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const seen = yield* observe()
      const fiber = yield* permission.ask(input).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(seen.asked), "permission was not asked")
      yield* permission.reply({ requestID: input.id, reply })
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(reply !== "reject")
      expect(yield* permission.list()).toEqual([])
      expect(seen.replies).toEqual([{ sessionID: input.sessionID, requestID: input.id, reply }])
    }),
  )
}

it.instance("interruption cannot remove a replacement request with the same ID", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const seen = yield* observe()
    const old = yield* permission.ask(input).pipe(Effect.forkScoped)
    yield* awaitWithTimeout(Deferred.await(seen.asked), "old permission was not asked")
    const replacement = { ...input, permission: "replacement", metadata: { replacement: true } }
    const next = yield* observe(false, replacement.permission)
    const current = yield* permission.ask(replacement).pipe(Effect.forkScoped)
    yield* awaitWithTimeout(Deferred.await(next.asked), "replacement was not asked")
    yield* Fiber.interrupt(old)
    expect((yield* permission.list()).map((item) => item.metadata)).toEqual([replacement.metadata])
    expect(seen.replies).toEqual([])
    yield* permission.reply({ requestID: input.id, reply: "once" })
    yield* Fiber.join(current)
    expect(seen.replies).toEqual([{ sessionID: input.sessionID, requestID: input.id, reply: "once" }])
  }),
)

it.instance("cancelling one ask does not reject another request in its session", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const seen = yield* observe()
    const first = yield* permission.ask(input).pipe(Effect.forkScoped)
    yield* awaitWithTimeout(Deferred.await(seen.asked), "first permission was not asked")
    const other = { ...input, id: PermissionV1.ID.make("per_other") }
    const next = yield* observe(false, "bash", other.id)
    const second = yield* permission.ask(other).pipe(Effect.forkScoped)
    yield* awaitWithTimeout(Deferred.await(next.asked), "second permission was not asked")
    yield* Fiber.interrupt(first)
    expect((yield* permission.list()).map((item) => item.id)).toEqual([other.id])
    expect(seen.replies).toEqual([{ sessionID: input.sessionID, requestID: input.id, reply: "reject" }])
    yield* permission.reply({ requestID: other.id, reply: "once" })
    yield* Fiber.join(second)
  }),
)

it.instance("bridge abort interrupts a real permission before its continuation", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const bridge = yield* EffectBridge.make()
    const seen = yield* observe()
    const controller = new AbortController()
    const effects: string[] = []
    const result = bridge
      .promise(permission.ask(input).pipe(Effect.andThen(Effect.sync(() => effects.push("executed")))), {
        signal: controller.signal,
      })
      .then(
        () => "completed",
        () => "interrupted",
      )
    yield* awaitWithTimeout(Deferred.await(seen.asked), "permission was not asked")
    controller.abort()
    expect(
      yield* awaitWithTimeout(
        Effect.promise(() => result),
        "bridge ignored cancellation",
      ),
    ).toBe("interrupted")
    expect(yield* permission.list()).toEqual([])
    expect(seen.replies).toEqual([{ sessionID: input.sessionID, requestID: input.id, reply: "reject" }])
    expect(yield* permission.reply({ requestID: input.id, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
      PermissionV1.NotFoundError,
    )
    expect(effects).toEqual([])
  }),
)

it.effect("bridge rejects a pre-aborted signal before synchronous side effects", () =>
  Effect.gen(function* () {
    const bridge = yield* EffectBridge.make()
    const controller = new AbortController()
    controller.abort()
    const effects: string[] = []
    const result = yield* Effect.promise(() =>
      bridge
        .promise(
          Effect.sync(() => effects.push("executed")),
          { signal: controller.signal },
        )
        .then(
          () => "completed",
          () => "interrupted",
        ),
    )
    expect(effects).toEqual([])
    expect(result).toBe("interrupted")
  }),
)

for (const reply of ["always", "reject"] as const) {
  it.instance(`normal ${reply} reply settles each affected sibling exactly once`, () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const seen = yield* observe()
      const first = yield* permission.ask(input).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(seen.asked), "first permission was not asked")
      const other = { ...input, id: PermissionV1.ID.make("per_sibling") }
      const next = yield* observe(false, "bash", other.id)
      const second = yield* permission.ask(other).pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(next.asked), "sibling permission was not asked")
      yield* permission.reply({ requestID: input.id, reply })
      expect(Exit.isSuccess(yield* Fiber.await(first))).toBe(reply === "always")
      expect(Exit.isSuccess(yield* Fiber.await(second))).toBe(reply === "always")
      expect(yield* permission.list()).toEqual([])
      expect(seen.replies).toEqual([
        { sessionID: input.sessionID, requestID: input.id, reply },
        { sessionID: input.sessionID, requestID: other.id, reply },
      ])
    }),
  )
}
