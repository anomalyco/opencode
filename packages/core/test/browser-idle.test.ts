import { expect } from "bun:test"
import { Clock, Context, Duration, Effect, Fiber, Layer, RcMap, Schedule } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Job } from "@opencode/core/job"
import { LocationActivity } from "@opencode/core/location-activity"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionStore } from "@opencode/core/session/store"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// LocationActivity measures idleness on this clock. Its sweep still sleeps in real time, but only the test moves the
// clock past the TTL, so slow plugin activation on a busy machine cannot evict the location before the browser
// attachment exists, as a short real TTL could.
const timeToLive = Duration.minutes(1)
const idle = { millis: 0 }
const live = Clock.Clock.defaultValue()
const activityClock: Clock.Clock = {
  currentTimeMillisUnsafe: () => live.currentTimeMillisUnsafe() + idle.millis,
  currentTimeMillis: Effect.sync(() => live.currentTimeMillisUnsafe() + idle.millis),
  currentTimeNanosUnsafe: () => live.currentTimeNanosUnsafe() + BigInt(idle.millis) * 1_000_000n,
  currentTimeNanos: Effect.sync(() => live.currentTimeNanosUnsafe() + BigInt(idle.millis) * 1_000_000n),
  monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
  monotonicTimeNanos: live.monotonicTimeNanos,
  sleep: (duration) => live.sleep(duration),
}

// A step's wait for its session's desktop runs on this clock, which never ends a sleep: such a step goes on only once
// the desktop is attached, however slow the machine is.
const unending: Clock.Clock = { ...live, sleep: () => Effect.never }

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Session.node, LocationServiceMap.node, LocationActivity.node]),
    [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      LocationActivity.node.replace(
        makeGlobalNode({
          service: LocationActivity.Service,
          layer: LocationActivity.layer({ timeToLive, sweepInterval: "100 millis" }).pipe(
            Layer.provide(Layer.succeed(Clock.Clock, activityClock)),
          ),
          deps: [Bus.node, Job.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node],
        }),
      ),
    ],
  ),
)

it.live(
  "idle eviction ends the browser attachment, and the session's next step waits for a fresh one",
  () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
      const locations = yield* LocationServiceMap.Service
      const context = yield* locations.contextEffect(ref).pipe(Effect.scoped)
      yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: ref })
      const rpc = Context.get(context, Rpc.Service).client(Browser.Definition)
      const attachment = { sessionID: session.id, connectionID: crypto.randomUUID() }
      const state = { ...attachment, state: { tabs: [], focusedTabID: null } }
      const pending = yield* rpc
        .attach({ ...attachment, version: 4 })
        .pipe(Effect.provide(locations.get(ref)), Effect.flip, Effect.forkScoped)
      yield* rpc.state(state).pipe(
        Effect.retry({
          while: (error) => "type" in error && error.type === "unavailable",
          schedule: Schedule.spaced("10 millis"),
        }),
        Effect.timeout("5 seconds"),
      )
      // The location has now been idle for its whole TTL; the next sweep evicts it.
      idle.millis += Duration.toMillis(timeToLive)

      // Real idle cleanup must end the long-lived request, not leave a second registry behind it.
      expect(yield* Fiber.join(pending).pipe(Effect.timeout("10 seconds"))).toMatchObject({ type: "rpc.unavailable" })
      expect(yield* RcMap.has(locations.rcMap, LocationServiceMap.canonical(ref))).toBe(false)
      expect(yield* rpc.state(state).pipe(Effect.flip)).toMatchObject({ type: "rpc.unavailable" })

      const replacement = yield* locations.contextEffect(ref)
      yield* Plugin.awaitActivation.pipe(Effect.provideContext(replacement))
      // The desktop attaches again once it sees the session run. The step that starts that run selects its tools
      // only after it did, so the step lists the browser.
      const step = yield* Context.get(replacement, PluginHooks.Service)
        .trigger("session", "experimental.step.before", { sessionID: session.id })
        .pipe(Effect.provideService(Clock.Clock, unending), Effect.forkScoped({ startImmediately: true }))
      expect(step.pollUnsafe()).toBeUndefined()
      const fresh = Context.get(replacement, Rpc.Service).client(Browser.Definition)
      const resumed = yield* fresh.attach({ ...attachment, version: 4 }).pipe(Effect.forkScoped)
      yield* Fiber.join(step)
      expect((yield* sessions.get(session.id)).permissions).toContainEqual({
        action: "browser",
        resource: "*",
        effect: "allow",
      })
      yield* fresh.state(state).pipe(
        Effect.retry({
          while: (error) => "type" in error && error.type === "unavailable",
          schedule: Schedule.spaced("10 millis"),
        }),
        Effect.timeout("5 seconds"),
      )
      expect(resumed.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(resumed)
    }),
  30_000,
)
