// Wake-on-message for idle task children — predicate unit tests.
//
// Tests Messaging's wake logic directly via spy handlers. Budget and handler
// tests use a minimal Messaging layer (no Session services). Predicate tests
// inject fake SessionStatus and Session services so they avoid the full
// Database/SessionProjector dependency graph. All tests run with instance
// context (it.instance) because Messaging uses InstanceState.
//
// The wake runs in a forked fiber; tests add a brief sleep after enqueue
// to let the forked fiber complete before assertions.

import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BackgroundJob } from "../../src/background/job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Messaging } from "../../src/messaging"
import { Session } from "../../src/session/session"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { WAKE_BUDGET_DEFAULT } from "../../src/tool/task"

const CHILD = SessionID.make("ses_child")
const PARENT = SessionID.make("ses_parent")
const FROM = SessionID.make("ses_from")

afterEach(async () => {
  await disposeAllInstances()
})

function spyHandler() {
  const calls: SessionID[] = []
  const handler = (sessionID: SessionID) =>
    Effect.sync(() => {
      calls.push(sessionID)
    })
  return { calls, handler }
}

const minRoot = LayerNode.group([Messaging.node, BackgroundJob.node, CrossSpawnSpawner.node])
const it = testEffect(LayerNode.compile(minRoot))

// ── Fake service builders for predicate tests ─────────────────────────────

type Chain = "intact" | "broken-parent"

function makeStatusLayer(idle: boolean) {
  let current: SessionStatus.Info = idle ? { type: "idle" } : { type: "busy" }
  return Layer.succeed(
    SessionStatus.Service,
    SessionStatus.Service.of({
      get: () => Effect.succeed(current),
      list: () => Effect.succeed(new Map()),
      set: (_id: SessionID, s: SessionStatus.Info) =>
        Effect.sync(() => {
          current = s
        }),
    }),
  )
}

function makeSessionLayer(chain: Chain, hasUserMessage: boolean) {
  return Layer.succeed(
    Session.Service,
    Session.Service.of({
      list: () => Effect.succeed([]),
      listGlobal: () => Effect.succeed([]),
      create: () => Effect.succeed({ id: CHILD, parentID: PARENT } as any),
      fork: () => Effect.succeed({ id: CHILD } as any),
      touch: () => Effect.void,
      get: (id: SessionID) => {
        if (id === CHILD) return Effect.succeed({ id: CHILD, parentID: PARENT } as any)
        if (id === PARENT && chain !== "broken-parent") return Effect.succeed({ id: PARENT, parentID: undefined } as any)
        return Effect.fail(new Error("not found") as any)
      },
      setTitle: () => Effect.void,
      setArchived: () => Effect.void,
      setMetadata: () => Effect.void,
      setResult: () => Effect.void,
      setAgentModel: () => Effect.void,
      setPermission: () => Effect.void,
      setRevert: () => Effect.void,
      clearRevert: () => Effect.void,
      setSummary: () => Effect.void,
      setShare: () => Effect.void,
      setWorkspace: () => Effect.void,
      diff: () => Effect.succeed([]),
      messages: () => Effect.succeed([]),
      children: () => Effect.succeed([]),
      remove: () => Effect.void,
      updateMessage: () => Effect.succeed({} as any),
      removeMessage: () => Effect.succeed("msg_01" as any),
      removePart: () => Effect.succeed("prt_01" as any),
      getPart: () => Effect.succeed(undefined),
      updatePart: () => Effect.succeed({} as any),
      updatePartDelta: () => Effect.void,
      findMessage: () =>
        hasUserMessage
          ? Effect.succeed(Option.some({ info: { role: "user" } } as any))
          : Effect.succeed(Option.none<any>()),
    }),
  )
}

// ── Budget & handler tests ───────────────────────────────────────────────

describe("Messaging wake-on-message — budget & handler", () => {
  it.instance(
    "no wake without a policy (default)",
    () =>
      Effect.gen(function* () {
        const messaging = yield* Messaging.Service
        const { calls, handler } = spyHandler()
        yield* messaging.registerWakeHandler(handler)
        yield* messaging.registerSlug("tgt", CHILD)
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "hi" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(0)
      }),
  )

  it.instance(
    "message to a wake-enabled recipient invokes the wake handler",
    () =>
      Effect.gen(function* () {
        const messaging = yield* Messaging.Service
        const { calls, handler } = spyHandler()
        yield* messaging.registerWakeHandler(handler)
        yield* messaging.setWakePolicy({ sessionID: CHILD, budget: 2 })
        yield* messaging.registerSlug("tgt", CHILD)
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "hi" })
        yield* Effect.sleep("50 millis")
        // Without SessionStatus/Session, predicate is skipped → always wake.
        expect(calls).toEqual([CHILD])
      }),
  )

  it.instance(
    "wake budget exhausts after WAKE_BUDGET_DEFAULT enqueues",
    () =>
      Effect.gen(function* () {
        const messaging = yield* Messaging.Service
        const { calls, handler } = spyHandler()
        yield* messaging.registerWakeHandler(handler)
        yield* messaging.setWakePolicy({ sessionID: CHILD, budget: WAKE_BUDGET_DEFAULT })
        yield* messaging.registerSlug("tgt", CHILD)
        for (let i = 0; i < WAKE_BUDGET_DEFAULT + 3; i++) {
          yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: `m${i}` })
        }
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(WAKE_BUDGET_DEFAULT)
        for (const c of calls) expect(c).toBe(CHILD)
      }),
  )

  it.instance(
    "setWakePolicy refreshes the budget",
    () =>
      Effect.gen(function* () {
        const messaging = yield* Messaging.Service
        const { calls, handler } = spyHandler()
        yield* messaging.registerWakeHandler(handler)
        yield* messaging.setWakePolicy({ sessionID: CHILD, budget: WAKE_BUDGET_DEFAULT })
        yield* messaging.registerSlug("tgt", CHILD)
        for (let i = 0; i < WAKE_BUDGET_DEFAULT; i++) {
          yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: `m${i}` })
        }
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(WAKE_BUDGET_DEFAULT)
        yield* messaging.setWakePolicy({ sessionID: CHILD, budget: WAKE_BUDGET_DEFAULT })
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "refresh" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(WAKE_BUDGET_DEFAULT + 1)
      }),
  )
})

// ── Predicate tests ──────────────────────────────────────────────────────

describe("Messaging wake-on-message — predicate checks", () => {
  it.instance(
    "idle child with user message → handler invoked",
    () => {
      const statusLayer = makeStatusLayer(true)
      const sessionLayer = makeSessionLayer("intact", true)
      return Effect.gen(function* () {
        const messaging = yield* Messaging.Service
        const { calls, handler } = spyHandler()
        yield* messaging.registerWakeHandler(handler)
        yield* messaging.setWakePolicy({ sessionID: CHILD, budget: 3 })
        yield* messaging.registerSlug("tgt", CHILD)
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "wake-idle" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(1)
        expect(calls[0]).toBe(CHILD)
      }).pipe(Effect.provide(Layer.mergeAll(statusLayer, sessionLayer)))
    },
  )

  it.instance(
    "busy child → handler NOT invoked, budget preserved",
    () => {
      const statusLayer = makeStatusLayer(false)
      const sessionLayer = makeSessionLayer("intact", true)
      return Effect.gen(function* () {
        const messaging = yield* Messaging.Service
        const { calls, handler } = spyHandler()
        yield* messaging.registerWakeHandler(handler)
        yield* messaging.setWakePolicy({ sessionID: CHILD, budget: 3 })
        yield* messaging.registerSlug("tgt", CHILD)

        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "busy" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(0)

        // Flip to idle via the mutable closure in makeStatusLayer.
        const statusCtrl = yield* SessionStatus.Service
        yield* statusCtrl.set(CHILD, { type: "idle" as const })
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "w1" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(1)
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "w2" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(2)
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "w3" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(3)
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "exhausted" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(3)
      }).pipe(Effect.provide(Layer.mergeAll(statusLayer, sessionLayer)))
    },
  )

  it.instance(
    "broken ancestor chain → handler NOT invoked",
    () => {
      const statusLayer = makeStatusLayer(true)
      const sessionLayer = makeSessionLayer("broken-parent", true)
      return Effect.gen(function* () {
        const messaging = yield* Messaging.Service
        const { calls, handler } = spyHandler()
        yield* messaging.registerWakeHandler(handler)
        yield* messaging.setWakePolicy({ sessionID: CHILD, budget: 3 })
        yield* messaging.registerSlug("tgt", CHILD)
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "no-ancestor" })
        yield* Effect.sleep("50 millis")
        expect(calls.length).toBe(0)
      }).pipe(Effect.provide(Layer.mergeAll(statusLayer, sessionLayer)))
    },
  )
})

// ── Wiring check ─────────────────────────────────────────────────────────

describe("Messaging wake-on-message — wiring", () => {
  it.instance(
    "registerWakeHandler persists correctly",
    () =>
      Effect.gen(function* () {
        const messaging = yield* Messaging.Service
        const { calls, handler } = spyHandler()
        yield* messaging.registerWakeHandler(handler)
        yield* messaging.setWakePolicy({ sessionID: CHILD, budget: 1 })
        yield* messaging.registerSlug("tgt", CHILD)
        yield* messaging.enqueue({ target: CHILD, from: FROM, fromSlug: "src", body: "wiring" })
        yield* Effect.sleep("50 millis")
        expect(calls).toEqual([CHILD])
      }),
  )
})
