import { expect } from "bun:test"
import { Clock, Context, Duration, Effect, Exit, Layer, RcMap, Schedule, Scope } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationActivity } from "@opencode/core/location-activity"
import { LocationLifecycle } from "@opencode/core/location-lifecycle"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionStore } from "@opencode/core/session/store"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// LocationActivity measures idleness on this clock; only the test moves it past the TTL (see browser-idle.test.ts).
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
  "idle sweep keeps a retained location and evicts it once released",
  () =>
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      const [retained, sibling] = yield* Effect.forEach([0, 1], () =>
        tmpdirScoped().pipe(
          Effect.map((dir) =>
            LocationServiceMap.canonical(Location.Ref.make({ directory: AbsolutePath.make(dir.path) })),
          ),
        ),
      )
      const lifecycle = Context.get(
        yield* locations.contextEffect(retained).pipe(Effect.scoped),
        LocationLifecycle.Service,
      )
      yield* locations.contextEffect(sibling).pipe(Effect.scoped)
      const hold = yield* Scope.make()
      yield* lifecycle.retain.pipe(Scope.provide(hold))
      const cached = (ref: Location.Ref) => RcMap.has(locations.rcMap, ref)
      // Each poll idles every location for a full TTL, whenever the sweep first saw it.
      const until = (check: Effect.Effect<boolean>) =>
        Effect.sync(() => {
          idle.millis += Duration.toMillis(timeToLive)
        }).pipe(
          Effect.andThen(check),
          Effect.flatMap((done) => (done ? Effect.void : Effect.fail("pending"))),
          Effect.retry(Schedule.spaced("20 millis")),
          Effect.timeout("10 seconds"),
          Effect.orDie,
        )

      // Both expired; the sweep that evicts the sibling skips the retained location.
      yield* until(cached(sibling).pipe(Effect.map((has) => !has)))
      expect(yield* cached(retained)).toBe(true)
      expect(lifecycle.isClosed()).toBe(false)

      yield* Scope.close(hold, Exit.void)
      yield* until(cached(retained).pipe(Effect.map((has) => !has)))
      expect(lifecycle.isClosed()).toBe(true)
    }),
  30_000,
)
