import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Cause, Effect, Exit, Fiber } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Vcs } from "../../src/project/vcs"
import { Session } from "../../src/session/session"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

// Session lineage decides what a session scoped lease covers, so these tests
// run against real sessions and therefore need the fully bootstrapped instance.
const env = AppNodeBuilder.build(
  LayerNode.group([
    Permission.node,
    Session.node,
    SessionProjector.node,
    Project.node,
    Vcs.node,
    Database.node,
    EventV2Bridge.node,
    FSUtil.node,
    CrossSpawnSpawner.node,
    InstanceStore.node,
  ]),
  [[InstanceStore.bootstrapNode, InstanceBootstrap.node]],
)
const it = testEffect(env)

// Bootstrapping a real instance is slow on a cold cache and a few of these
// tests deliberately wait out a lease expiry.
const TIMEOUT = 20_000

// The whole point of the lease is that covered requests never reach an
// integration, so every test that claims "auto approved" also proves no
// `permission.asked` was published for it.
const recordAsked = Effect.gen(function* () {
  const events = yield* EventV2Bridge.Service
  const asked: string[] = []
  const unsubscribe = yield* events.listen((event) =>
    Effect.sync(() => {
      if (event.type !== "permission.asked") return
      asked.push((event.data as PermissionV1.Request).sessionID)
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return asked
})

const ask = (sessionID: SessionID, ruleset: PermissionV1.Ruleset = [], patterns = ["ls"]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask({
      sessionID,
      permission: "bash",
      patterns,
      metadata: {},
      always: [],
      ruleset,
    })
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    while (true) {
      const list = yield* permission.list()
      if (list.length === count) return list
      yield* Effect.sleep("10 millis")
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: "2 seconds",
      orElse: () => Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`)),
    }),
  )

// Rejecting one request also rejects the rest of its session, so ignore the
// misses this leaves behind.
const rejectAll = Effect.gen(function* () {
  const permission = yield* Permission.Service
  for (const request of yield* permission.list()) {
    yield* Effect.ignore(permission.reply({ requestID: request.id, reply: "reject" }))
  }
})

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected permission effect to fail")
  })

it.instance(
  "auto lease resolves a covered request without publishing permission.asked",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const asked = yield* recordAsked

      yield* permission.autoAcquire({ scope: { type: "instance" } })
      yield* ask(SessionID.make("session_covered"))

      expect(asked).toEqual([])
      expect(yield* permission.list()).toEqual([])
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "requests still ask when no lease is held",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const asked = yield* recordAsked

      const fiber = yield* ask(SessionID.make("session_uncovered")).pipe(Effect.forkScoped)
      yield* waitForPending(1)

      expect(asked).toEqual(["session_uncovered"])
      yield* rejectAll
      yield* Fiber.await(fiber)
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "explicit deny still wins while a lease is held",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      yield* permission.autoAcquire({ scope: { type: "instance" } })

      const denied = yield* fail(
        ask(SessionID.make("session_denied"), [{ permission: "bash", pattern: "*", action: "deny" }]),
      )
      expect(denied).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "a single denied pattern fails the request even when the rest are covered",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const asked = yield* recordAsked
      yield* permission.autoAcquire({ scope: { type: "instance" } })

      const denied = yield* fail(
        ask(
          SessionID.make("session_mixed"),
          [
            { permission: "bash", pattern: "*", action: "ask" },
            { permission: "bash", pattern: "rm *", action: "deny" },
          ],
          ["ls", "rm -rf /"],
        ),
      )
      expect(denied).toBeInstanceOf(PermissionV1.DeniedError)
      expect(asked).toEqual([])
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "acquiring a lease leaves requests that were already pending alone",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const fiber = yield* ask(SessionID.make("session_pending")).pipe(Effect.forkScoped)
      const [pending] = yield* waitForPending(1)

      yield* permission.autoAcquire({ scope: { type: "instance" } })
      yield* Effect.sleep("50 millis")

      expect(yield* permission.list()).toHaveLength(1)

      yield* permission.reply({ requestID: pending.id, reply: "once" })
      yield* Fiber.await(fiber)
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "releasing a lease restores interactive behaviour",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const lease = yield* permission.autoAcquire({ scope: { type: "instance" } })
      expect(yield* permission.autoList()).toEqual([lease])

      yield* ask(SessionID.make("session_released"))
      expect(yield* permission.autoRelease(lease.id)).toBe(true)
      expect(yield* permission.autoList()).toEqual([])
      expect(yield* permission.autoRelease(lease.id)).toBe(false)

      const fiber = yield* ask(SessionID.make("session_released")).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      yield* rejectAll
      yield* Fiber.await(fiber)
    }),
  { git: true },
  TIMEOUT,
)

// Stopping renewal is what a crashed or SIGKILLed owner looks like to the
// server: nothing is released, the lease simply stops being renewed.
it.instance(
  "a lease whose owner stops renewing expires and stops covering requests",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const lease = yield* permission.autoAcquire({
        scope: { type: "instance" },
        ttl: PermissionV1.AUTO_LEASE_TTL_MIN,
      })
      expect(lease.ttl).toBe(PermissionV1.AUTO_LEASE_TTL_MIN)

      yield* Effect.sleep(PermissionV1.AUTO_LEASE_TTL_MIN + 200)

      expect(yield* permission.autoList()).toEqual([])
      expect(yield* fail(permission.autoRenew(lease.id))).toBeInstanceOf(PermissionV1.AutoLeaseNotFoundError)

      const fiber = yield* ask(SessionID.make("session_expired")).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      yield* rejectAll
      yield* Fiber.await(fiber)
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "renewing keeps a lease covering requests past its original expiry",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const asked = yield* recordAsked
      const lease = yield* permission.autoAcquire({
        scope: { type: "instance" },
        ttl: PermissionV1.AUTO_LEASE_TTL_MIN,
      })

      yield* Effect.sleep(PermissionV1.AUTO_LEASE_TTL_MIN - 300)
      const renewed = yield* permission.autoRenew(lease.id)
      expect(renewed.expires).toBeGreaterThan(lease.expires)

      yield* Effect.sleep(400)
      yield* ask(SessionID.make("session_renewed"))
      expect(asked).toEqual([])
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "ttl is clamped to the range the server is willing to honour",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const tooShort = yield* permission.autoAcquire({ scope: { type: "instance" }, ttl: 1 })
      const tooLong = yield* permission.autoAcquire({
        scope: { type: "instance" },
        ttl: PermissionV1.AUTO_LEASE_TTL_MAX * 10,
      })
      const unset = yield* permission.autoAcquire({ scope: { type: "instance" } })

      expect(tooShort.ttl).toBe(PermissionV1.AUTO_LEASE_TTL_MIN)
      expect(tooLong.ttl).toBe(PermissionV1.AUTO_LEASE_TTL_MAX)
      expect(unset.ttl).toBe(PermissionV1.AUTO_LEASE_TTL_DEFAULT)
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "a session scoped lease covers descendant sessions but nothing else",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "run" })
      const child = yield* sessions.create({ parentID: root.id, title: "subagent" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "nested subagent" })
      const unrelated = yield* sessions.create({ title: "someone else" })
      const asked = yield* recordAsked

      yield* permission.autoAcquire({ scope: { type: "session", sessionID: root.id } })

      yield* ask(root.id)
      yield* ask(child.id)
      yield* ask(grandchild.id)
      expect(asked).toEqual([])

      const fiber = yield* ask(unrelated.id).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      expect(asked).toEqual([unrelated.id])

      yield* rejectAll
      yield* Fiber.await(fiber)
    }),
  { git: true },
  TIMEOUT,
)

// `opencode run --attach --auto` against a shared server, and a second client
// working on that server at the same time.
it.instance(
  "two clients keep separate auto authority",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const a = yield* sessions.create({ title: "client a" })
      const b = yield* sessions.create({ title: "client b" })
      const asked = yield* recordAsked

      // Client B is mid-prompt before client A turns auto on.
      const pendingB = yield* ask(b.id).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      expect(asked).toEqual([b.id])

      const lease = yield* permission.autoAcquire({ scope: { type: "session", sessionID: a.id } })

      // B's visible prompt is untouched, A's new work is approved silently.
      yield* Effect.sleep("50 millis")
      expect(yield* permission.list()).toHaveLength(1)
      yield* ask(a.id)
      expect(asked).toEqual([b.id])

      // B keeps asking for new work too.
      const secondB = yield* ask(b.id).pipe(Effect.forkScoped)
      yield* waitForPending(2)
      expect(asked).toEqual([b.id, b.id])

      // Client A exits: its authority goes with it and A asks again.
      yield* permission.autoRelease(lease.id)
      const afterA = yield* ask(a.id).pipe(Effect.forkScoped)
      yield* waitForPending(3)
      expect(asked).toEqual([b.id, b.id, a.id])

      yield* rejectAll
      yield* Fiber.await(pendingB)
      yield* Fiber.await(secondB)
      yield* Fiber.await(afterA)
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "an instance scoped lease covers every session in the instance",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const first = yield* sessions.create({ title: "first" })
      const second = yield* sessions.create({ title: "second" })
      const asked = yield* recordAsked

      yield* permission.autoAcquire({ scope: { type: "instance" } })
      yield* ask(first.id)
      yield* ask(second.id)

      expect(asked).toEqual([])
    }),
  { git: true },
  TIMEOUT,
)

it.instance(
  "leases do not resolve a doom_loop request that a deny rule forbids",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const asked = yield* recordAsked
      yield* permission.autoAcquire({ scope: { type: "instance" } })

      yield* permission.ask({
        sessionID: SessionID.make("session_doom"),
        permission: "doom_loop",
        patterns: ["*"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(asked).toEqual([])

      const denied = yield* fail(
        permission.ask({
          sessionID: SessionID.make("session_doom"),
          permission: "doom_loop",
          patterns: ["*"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "doom_loop", pattern: "*", action: "deny" }],
        }),
      )
      expect(denied).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  { git: true },
  TIMEOUT,
)
