import { describe, expect } from "bun:test"
import { Effect, Layer, LayerMap, RcMap } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationActivity } from "@opencode/core/location-activity"
import { LocationRetention } from "@opencode/core/location-retention"
import { LocationServiceMap, type LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionStore } from "@opencode/core/session/store"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// Same stub as location-activity.test.ts: locations cache entries with an
// infinite LayerMap TTL, so only the activity sweep (or explicit invalidate)
// can remove them.
const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.succeed(
          Location.Service,
          Location.Service.of({
            directory: ref.directory,
            workspaceID: ref.workspaceID,
            project: { id: Project.ID.global, directory: ref.directory, canonical: ref.directory },
          }),
        ).pipe(Layer.provide(Layer.succeed(Bus.Service, bus))) as unknown as Layer.Layer<LocationServices>,
      { idleTimeToLive: "Infinity" },
    )
    return {
      ...map,
      get: (ref: Location.Ref) => map.get(LocationServiceMap.canonical(ref)),
      contextEffect: (ref: Location.Ref) => map.contextEffect(LocationServiceMap.canonical(ref)),
      contextEffectOption: (ref: Location.Ref) => map.contextEffectOption(LocationServiceMap.canonical(ref)),
      invalidate: (ref: Location.Ref) => map.invalidate(LocationServiceMap.canonical(ref)),
    }
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      LocationServiceMap.node,
      SessionExecution.node,
      LocationActivity.node,
      LocationRetention.node,
    ]),
    [
      LocationServiceMap.node.replace(
        makeGlobalNode({
          service: LocationServiceMap.Service,
          layer: locations,
          deps: [Bus.node],
        }),
      ),
      LocationActivity.node.replace(
        makeGlobalNode({
          service: LocationActivity.Service,
          layer: LocationActivity.layer({ timeToLive: "2 seconds", sweepInterval: "100 millis" }),
          deps: [Bus.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node, LocationRetention.node],
        }),
      ),
    ],
  ),
)

describe("LocationActivity live-process exemption", () => {
  it.effect("defers eviction while a child process is live, evicts after release", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
      const canonical = LocationServiceMap.canonical(ref)
      const map = yield* LocationServiceMap.Service
      const retention = yield* LocationRetention.Service
      // Boot the location, then drop the reference: the entry sits cached
      // with no borrower, exactly like an idle background-shell location.
      yield* Location.Service.pipe(Effect.provide(map.get(ref)), Effect.scoped)
      expect(yield* RcMap.has(map.rcMap, canonical)).toBe(true)

      // A live child (e.g. Shell.create) pins the location; the sweep must
      // keep deferring past the TTL instead of invalidating.
      yield* retention.retain(ref)
      yield* TestClock.adjust("10 seconds")
      expect(yield* RcMap.has(map.rcMap, canonical)).toBe(true)
      yield* TestClock.adjust("10 seconds")
      expect(yield* RcMap.has(map.rcMap, canonical)).toBe(true)

      // Once the child settles and releases, the next deadline evicts.
      yield* retention.release(ref)
      yield* TestClock.adjust("10 seconds")
      expect(yield* RcMap.has(map.rcMap, canonical)).toBe(false)
    }),
  )

  it.effect("explicit invalidate still tears down a pinned location", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
      const canonical = LocationServiceMap.canonical(ref)
      const map = yield* LocationServiceMap.Service
      const retention = yield* LocationRetention.Service
      yield* Location.Service.pipe(Effect.provide(map.get(ref)), Effect.scoped)
      yield* retention.retain(ref)
      yield* TestClock.adjust("10 seconds")
      expect(yield* RcMap.has(map.rcMap, canonical)).toBe(true)

      yield* map.invalidate(ref)
      expect(yield* RcMap.has(map.rcMap, canonical)).toBe(false)
      yield* retention.release(ref)
      expect(yield* retention.live()).toEqual([])
    }),
  )
})
