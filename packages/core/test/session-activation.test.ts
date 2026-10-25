import { describe, expect, setDefaultTimeout } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { SessionStatusEvent } from "@opencode/schema/session-status-event"
import path from "path"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// Real Location boot with plugin discovery, so the first request races the initial plugin activation.
setDefaultTimeout(30_000)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

// Execution stub for tests that gate settlement themselves; every gate lives in the test that owns it.
const idleExecution: SessionExecution.Interface = {
  active: Effect.succeed(new Set<Session.ID>()),
  isActive: () => Effect.succeed(false),
  resume: () => Effect.void,
  wake: () => Effect.void,
  interrupt: () => Effect.succeed(false),
  awaitIdle: () => Effect.void,
}

const sessionStack = (execution: Partial<SessionExecution.Interface>) =>
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      SessionExecution.node.replace(Layer.succeed(SessionExecution.Service, { ...idleExecution, ...execution })),
    ],
  )

// Records the session's published status types and signals the first idle.
const recordStatus = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const states: string[] = []
    const idle = yield* Deferred.make<void>()
    const unsubscribe = yield* bus.listen((event) => Effect.gen(function* () {
      if (event.type !== SessionStatusEvent.Status.type) return
      const data = Schema.decodeUnknownSync(SessionStatusEvent.Status.data)(event.data)
      if (data.sessionID !== sessionID) return
      states.push(data.status.type)
      if (data.status.type === "idle") yield* Deferred.succeed(idle, undefined)
    }))
    yield* Effect.addFinalizer(() => unsubscribe)
    return { states, idle }
  })


const project = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      path.join(tmp.path, ".opencode/plugins/prompt.ts"),
      `export default {
        id: "prompt-readiness",
        async setup(ctx) {
          await ctx.session.hook("prompt", (event) => {
            event.prompt.text = "Prepared by plugin"
          })
          await ctx.command.transform((editor) =>
            editor.add({ name: "ready", description: "Registered by plugin", execute: async () => {} }),
          )
        },
      }`,
    ),
  )
  return tmp
})

describe("Session waits for plugin activation", () => {
  testEffect(Layer.empty).live("keeps waiting when resume restarts execution before the settlement ownership check", () =>
    Effect.gen(function* () {
      const active = new Set<Session.ID>()
      const firstSettled = yield* Deferred.make<void>()
      const restarted = yield* Deferred.make<void>()
      const secondSettled = yield* Deferred.make<void>()
      let waits = 0
      const layer = sessionStack({
        active: Effect.sync(() => new Set(active)),
        isActive: (sessionID) => Effect.sync(() => active.has(sessionID)),
        wake: (sessionID) => Effect.sync(() => { active.add(sessionID) }),
        resume: (sessionID) => Effect.sync(() => { active.add(sessionID) }),
        awaitIdle: () => Effect.gen(function* () {
          if (++waits === 1) return yield* Deferred.await(firstSettled)
          yield* Deferred.succeed(restarted, undefined)
          yield* Deferred.await(secondSettled)
        }),
      })
      yield* Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
        const { states, idle } = yield* recordStatus(session.id)
        yield* sessions.prompt({ sessionID: session.id, text: "Run" })
        // The first execution settles and a non-prompt resume restarts it before the waiter's ownership check.
        active.delete(session.id)
        yield* sessions.resume(session.id)
        yield* Deferred.succeed(firstSettled, undefined)
        yield* Deferred.await(restarted).pipe(Effect.timeout("2 seconds"))
        expect(states).toEqual(["busy"])
        active.delete(session.id)
        yield* Deferred.succeed(secondSettled, undefined)
        yield* Deferred.await(idle)
        expect(states).toEqual(["busy", "idle"])
        expect(waits).toBe(2)
      }).pipe(Effect.provide(layer))
    }),
  )

  testEffect(Layer.empty).live("does not let old preparation cleanup overwrite a newer prompt's busy status", () =>
    Effect.gen(function* () {
      const checking = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let paused = true
      const layer = sessionStack({
        // Hold the old prompt's execution-ownership check while a newer prompt arrives.
        isActive: () => Effect.gen(function* () {
          if (!paused) return false
          paused = false
          yield* Deferred.succeed(checking, undefined)
          yield* Deferred.await(release)
          return false
        }),
      })
      yield* Effect.gen(function* () {
        const tmp = yield* project
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
        const { states } = yield* recordStatus(session.id)
        const first = yield* sessions.prompt({ sessionID: session.id, text: "First", resume: false }).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(checking)
        const second = yield* sessions.prompt({ sessionID: session.id, text: "Second", resume: false }).pipe(Effect.forkScoped({ startImmediately: true }))
        // Registered last so teardown releases the held cleanup before interrupting either uninterruptible prompt.
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        // The newer prompt's busy waits behind the old cleanup instead of being overwritten by it.
        expect(states).toEqual(["busy"])
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(states).toEqual(["busy", "idle", "busy", "idle"])
      }).pipe(Effect.scoped, Effect.provide(layer))
    }),
  )

  testEffect(Layer.empty).live("publishes idle once the woken execution settles", () =>
    Effect.gen(function* () {
      // wake marks the session active synchronously, as RunCoordinator.wake does.
      const active = new Set<Session.ID>()
      const settled = yield* Deferred.make<void>()
      const layer = sessionStack({
        active: Effect.sync(() => new Set(active)),
        isActive: (sessionID) => Effect.sync(() => active.has(sessionID)),
        wake: (sessionID) => Effect.sync(() => { active.add(sessionID) }),
        awaitIdle: (sessionID) => Effect.suspend(() => (active.has(sessionID) ? Deferred.await(settled) : Effect.void)),
      })
      yield* Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
        const { states, idle } = yield* recordStatus(session.id)
        yield* sessions.prompt({ sessionID: session.id, text: "Run" })
        // Preparation handed off to the woken execution: busy stands until settlement.
        expect(states).toEqual(["busy"])
        active.clear()
        yield* Deferred.succeed(settled, undefined)
        yield* Deferred.await(idle)
        expect(states).toEqual(["busy", "idle"])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("publishes busy before cold plugin setup, then clears preparation-only status", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const gate = path.join(tmp.path, "release")
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".opencode/plugins/slow.ts"), `export default {
        id: "slow-readiness", async setup() {
          while (!(await Bun.file(${JSON.stringify(gate)}).exists())) await Bun.sleep(10)
        }
      }`))
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const busy = yield* Deferred.make<void>()
      const states: string[] = []
      const unsubscribe = yield* bus.listen((event) => Effect.gen(function* () {
        if (event.type !== SessionStatusEvent.Status.type) return
        const data = Schema.decodeUnknownSync(SessionStatusEvent.Status.data)(event.data)
        if (data.sessionID !== session.id) return
        states.push(data.status.type)
        if (data.status.type === "busy") yield* Deferred.succeed(busy, undefined)
      }))
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* Effect.addFinalizer(() => Effect.promise(() => Bun.write(gate, "release")).pipe(Effect.asVoid))
      const prompt = yield* sessions.prompt({ sessionID: session.id, text: "Waiting", resume: false }).pipe(Effect.forkScoped)
      yield* Deferred.await(busy).pipe(Effect.timeout("2 seconds"))
      expect(yield* Effect.promise(() => Bun.file(gate).exists())).toBe(false)
      yield* Effect.promise(() => Bun.write(gate, "release"))
      yield* Fiber.join(prompt)
      expect(states).toEqual(["busy", "idle"])
    }),
  )
  it.live("runs prompt hooks from a cold Location before admitting a prompt", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const admitted = yield* sessions.prompt({ sessionID: session.id, text: "Original", resume: false })
      expect(admitted.payload.text).toBe("Prepared by plugin")
    }),
  )

  it.live("clears early busy status when preparation fails", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const states: string[] = []
      const unsubscribe = yield* bus.listen((event) => Effect.sync(() => {
        if (event.type !== SessionStatusEvent.Status.type) return
        const data = Schema.decodeUnknownSync(SessionStatusEvent.Status.data)(event.data)
        if (data.sessionID === session.id) states.push(data.status.type)
      }))
      yield* Effect.addFinalizer(() => unsubscribe)
      const result = yield* sessions.prompt({ sessionID: session.id, text: "Rejected", files: [{ uri: "file:///missing-readiness-attachment.txt" }], resume: false }).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
      expect(states).toEqual(["busy", "idle"])
    }),
  )

  it.live("resolves plugin commands from a cold Location", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      yield* sessions.command({ sessionID: session.id, command: "ready", text: "now" })
    }),
  )
})
