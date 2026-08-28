import { describe, expect } from "bun:test"
import type { Instance } from "@opencode-ai/core/instance"
import { InstanceKey } from "@opencode-ai/core/instance-key"
import { Entry, fromMap } from "@opencode-ai/core/instance-map/internal"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { Context, Deferred, Duration, Effect, Equal, Exit, Fiber, Hash, Layer, LayerMap, RcMap, Scope } from "effect"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
const firstLocation = Location.Ref.make({ directory: AbsolutePath.make("/first") })
const secondLocation = Location.Ref.make({ directory: AbsolutePath.make("/second") })

class Value extends Context.Service<Value, { readonly location: Location.Ref }>()("InstanceMapTest/Value") {}

describe("InstanceMap", () => {
  it.effect("shares concurrent acquisitions by key and retains the first attempted input", () =>
    Effect.gen(function* () {
      const first = new Entry(InstanceKey.Key("shared"), firstLocation)
      const later = new Entry(first.key, secondLocation)
      const other = new Entry(InstanceKey.Key("isolated"), firstLocation)
      expect(Equal.equals(first, later)).toBe(true)
      expect(Hash.hash(first)).toBe(Hash.hash(later))
      expect(Equal.equals(first, other)).toBe(false)

      const attempted: Entry[] = []
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const map = yield* LayerMap.make((entry: Entry) =>
        Layer.effect(
          Value,
          Effect.gen(function* () {
            attempted.push(entry)
            if (entry.key === first.key) {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
            }
            return { location: entry.location }
          }),
        ),
      )

      const firstFiber = yield* map.contextEffect(first).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(started)
      const laterFiber = yield* map.contextEffect(later).pipe(Effect.forkChild({ startImmediately: true }))
      expect(firstFiber.pollUnsafe()).toBeUndefined()
      expect(laterFiber.pollUnsafe()).toBeUndefined()
      expect(yield* RcMap.has(map.rcMap, later)).toBe(true)

      // A different key can finish while the shared key is still constructing.
      const isolated = yield* map.contextEffect(other)
      expect(attempted).toEqual([first, other])
      expect(Array.from(yield* RcMap.keys(map.rcMap))[0]).toBe(first)
      yield* Deferred.succeed(release, undefined)
      const shared = yield* Fiber.join(firstFiber)
      expect(yield* Fiber.join(laterFiber)).toBe(shared)
      expect(Context.get(shared, Value).location).toBe(first.location)
      expect(Context.get(isolated, Value)).not.toBe(Context.get(shared, Value))
      expect(attempted).toEqual([first, other])
    }),
  )

  it.effect("releases idle entries and lets the next acquisition reseed construction", () =>
    Effect.gen(function* () {
      const first = new Entry(InstanceKey.Key("shared"), firstLocation)
      const later = new Entry(first.key, secondLocation)
      const acquired: Entry[] = []
      const released: Entry[] = []
      const map = yield* LayerMap.make(
        (entry: Entry) =>
          Layer.effect(
            Value,
            Effect.acquireRelease(
              Effect.sync(() => {
                acquired.push(entry)
                return { location: entry.location }
              }),
              () => Effect.sync(() => released.push(entry)),
            ),
          ),
        { idleTimeToLive: Duration.infinity },
      )
      const scope = yield* Effect.scope
      const firstScope = yield* Scope.fork(scope, "sequential")
      const laterScope = yield* Scope.fork(scope, "sequential")
      const original = yield* map.contextEffect(first).pipe(Scope.provide(firstScope))
      expect(yield* map.contextEffect(later).pipe(Scope.provide(laterScope))).toBe(original)
      yield* Scope.close(firstScope, Exit.void)
      expect(released).toEqual([])
      expect(yield* RcMap.has(map.rcMap, later)).toBe(true)
      yield* Scope.close(laterScope, Exit.void)
      expect(released).toEqual([])

      // Invalidate only after every consumer releases; active replacement is out of scope.
      yield* map.invalidate(later)
      expect(released).toEqual([first])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      const reseeded = yield* map.contextEffect(later).pipe(Effect.scoped)
      expect(reseeded).not.toBe(original)
      expect(Context.get(reseeded, Value).location).toBe(later.location)
      expect(acquired).toEqual([first, later])
      expect(Array.from(yield* RcMap.keys(map.rcMap))[0]).toBe(later)
      yield* map.invalidate(first)
      expect(released).toEqual([first, later])
    }),
  )

  it.effect("keeps the first seed even when an infinite-TTL construction fails", () =>
    Effect.gen(function* () {
      const first = new Entry(InstanceKey.Key("failed"), firstLocation)
      const later = new Entry(first.key, secondLocation)
      const attempted: Entry[] = []
      const map = yield* LayerMap.make(
        (entry: Entry) =>
          Layer.effect(
            Value,
            Effect.sync(() => attempted.push(entry)).pipe(Effect.andThen(Effect.fail(entry.location))),
          ),
        { idleTimeToLive: Duration.infinity },
      )

      expect(yield* map.contextEffect(first).pipe(Effect.scoped, Effect.flip)).toBe(first.location)
      expect(yield* map.contextEffect(later).pipe(Effect.scoped, Effect.flip)).toBe(first.location)
      expect(attempted).toEqual([first])
      expect(yield* RcMap.has(map.rcMap, later)).toBe(true)
      expect(Array.from(yield* RcMap.keys(map.rcMap))[0]).toBe(first)

      yield* map.invalidate(later)
      expect(yield* RcMap.has(map.rcMap, first)).toBe(false)
      expect(yield* map.contextEffect(later).pipe(Effect.scoped, Effect.flip)).toBe(later.location)
      expect(attempted).toEqual([first, later])
      expect(Array.from(yield* RcMap.keys(map.rcMap))[0]).toBe(later)
    }),
  )

  it.effect("exposes canonical retained refs and inspects or invalidates without booting", () =>
    Effect.gen(function* () {
      const attempted: Entry[] = []
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const map = fromMap(
        yield* LayerMap.make(
          (entry: Entry) => {
            const layer = Layer.effect(
              Location.Service,
              Effect.gen(function* () {
                attempted.push(entry)
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
                return location(entry.location)
              }),
            )
            // Fixture boundary widens only output; dependencies and errors stay typed.
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            return layer as unknown as Layer.Layer<Instance.Services>
          },
          { idleTimeToLive: Duration.infinity },
        ),
      )
      const ref = Location.Ref.make({
        directory: AbsolutePath.make(process.platform === "win32" ? "C:/workspace\\repo" : "/workspace/repo"),
        workspaceID: undefined,
      })
      const canonical = Location.Ref.make({
        directory: AbsolutePath.make(process.platform === "win32" ? "C:\\workspace\\repo" : "/workspace/repo"),
      })
      const workspace = Location.Ref.make({
        ...canonical,
        workspaceID: Workspace.ID.make("wrk_team:alpha%3A\\segment"),
      })
      expect(map).not.toHaveProperty("rcMap")
      expect(yield* map.has(ref)).toBe(false)
      expect(yield* map.entries).toEqual([])
      yield* map.invalidate(ref)
      expect(attempted).toEqual([])

      const pending = yield* map.contextEffect(ref).pipe(Effect.scoped, Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(started)
      expect(yield* map.has(canonical)).toBe(true)
      expect(yield* map.entries).toEqual([{ key: Location.instanceKey(canonical), location: canonical }])
      expect(Object.keys(attempted[0]?.location ?? {})).toEqual(["directory"])
      expect(pending.pollUnsafe()).toBeUndefined()
      yield* map.invalidate(workspace)
      expect(yield* map.has(workspace)).toBe(false)
      expect(attempted).toHaveLength(1)

      yield* Deferred.succeed(release, undefined)
      const context = yield* Fiber.join(pending)
      expect(yield* map.contextEffect(canonical).pipe(Effect.scoped)).toBe(context)
      expect(yield* Location.Service.pipe(Effect.provide(map.get(canonical)), Effect.scoped)).toBe(
        Context.get(context, Location.Service),
      )
      expect(yield* Location.Service.pipe(Effect.provide(map.forSession({ location: ref })), Effect.scoped)).toBe(
        Context.get(context, Location.Service),
      )
      expect(Context.get(context, Location.Service).directory).toBe(canonical.directory)
      expect(attempted).toHaveLength(1)

      const workspaceContext = yield* map.contextEffect(workspace).pipe(Effect.scoped)
      expect(workspaceContext).not.toBe(context)
      expect(Context.get(workspaceContext, Location.Service).workspaceID).toBe(workspace.workspaceID)
      expect(yield* map.entries).toEqual([
        { key: Location.instanceKey(canonical), location: canonical },
        { key: Location.instanceKey(workspace), location: workspace },
      ])
      yield* map.invalidate(ref)
      expect(yield* map.has(canonical)).toBe(false)
      expect(yield* map.entries).toEqual([{ key: Location.instanceKey(workspace), location: workspace }])
      expect(attempted).toHaveLength(2)
      yield* map.invalidate(workspace)
      expect(yield* map.entries).toEqual([])
    }),
  )
})
