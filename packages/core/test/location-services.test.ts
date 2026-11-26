import { describe, expect } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from "effect"
import { Global } from "@opencode/util/global"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Instance } from "@opencode/core/instance"
import { Location } from "@opencode/core/location"
import { LocationLifecycle } from "@opencode/core/location-lifecycle"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/core/schema"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// Counts every instance the map opens and closes, default and private alike.
function host() {
  const state = { opened: 0, closed: 0 }
  const replacements = [
    Global.node.replace(tempGlobalLayer),
    Watcher.node.replace(Watcher.configured({ enabled: false })),
    offlineModels,
    LocationLifecycle.node.replace(
      LocationLifecycle.node.mapLayer((layer) =>
        layer.pipe(
          Layer.tap(() =>
            Effect.acquireRelease(
              Effect.sync(() => state.opened++),
              () => Effect.sync(() => state.closed++),
            ),
          ),
        ),
      ),
    ),
  ]
  return { state, layer: AppNodeBuilder.build(LocationServiceMap.node, replacements) }
}

const locationAt = Effect.fn(function* () {
  const dir = yield* tmpdirScoped()
  return Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
})

const register = (locations: LocationServiceMap.Interface, build: LocationServiceMap.PrivateBuild) =>
  locations.instances ? locations.instances(build) : Effect.die(new Error("no private instances"))

const plain: LocationServiceMap.PrivateBuild = (ref, _key, resolved) => Instance.layer(ref, { host: resolved })

const boot = (layer: Layer.Layer<Instance.Services, Instance.Error>) => Effect.scoped(Layer.build(layer))

describe("location services", () => {
  it.live("closes a Location invalidated while borrowed when the host closes", () =>
    Effect.gen(function* () {
      // Created before the host so its cleanup runs after the host closes.
      const ref = yield* locationAt()
      const fixture = host()
      const owner = yield* Scope.make()
      const locations = Context.get(yield* Layer.buildWithScope(fixture.layer, owner), LocationServiceMap.Service)
      const borrower = yield* Scope.make()
      yield* locations.contextEffect(ref).pipe(Scope.provide(borrower))

      yield* locations.invalidate(ref)
      expect(yield* locations.has(ref)).toBe(false)
      expect(fixture.state).toEqual({ opened: 1, closed: 0 })

      yield* Scope.close(owner, Exit.void)
      expect(fixture.state).toEqual({ opened: 1, closed: 1 })
      yield* Scope.close(borrower, Exit.void)
      expect(fixture.state).toEqual({ opened: 1, closed: 1 })
    }),
  )

  it.live("invalidates and reloads the default and every private instance at a Location", () =>
    Effect.gen(function* () {
      const ref = yield* locationAt()
      const fixture = host()
      const locations = Context.get(yield* Layer.build(fixture.layer), LocationServiceMap.Service)
      const privates = yield* register(locations, plain)
      yield* boot(locations.get(ref))
      yield* boot(privates.get(ref, "a"))
      yield* boot(privates.get(ref, "b"))
      expect(fixture.state).toEqual({ opened: 3, closed: 0 })

      yield* locations.reload
      expect(fixture.state).toEqual({ opened: 6, closed: 3 })
      expect(yield* locations.keys).toEqual([LocationServiceMap.canonical(ref)])
      expect(yield* privates.has(ref, "a")).toBe(true)
      expect(yield* privates.has(ref, "b")).toBe(true)

      yield* locations.invalidate(ref)
      expect(fixture.state).toEqual({ opened: 6, closed: 6 })
      expect(yield* locations.has(ref)).toBe(false)
      expect(yield* privates.has(ref, "a")).toBe(false)
      expect(yield* privates.has(ref, "b")).toBe(false)
      expect(yield* locations.keys).toEqual([])
    }),
  )

  it.live("detaches a private build invalidated while it is still configuring", () =>
    Effect.gen(function* () {
      const ref = yield* locationAt()
      const fixture = host()
      const locations = Context.get(yield* Layer.build(fixture.layer), LocationServiceMap.Service)
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const state = { attempts: 0 }
      const privates = yield* register(locations, (at, _key, resolved) =>
        Layer.unwrap(
          Effect.gen(function* () {
            state.attempts++
            if (state.attempts === 1) {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
            }
            return Instance.layer(at, { host: resolved })
          }),
        ),
      )
      const lifecycle = (context: Context.Context<Instance.Services>) => Context.get(context, LocationLifecycle.Service)
      const borrower = yield* Scope.make()
      const stale = yield* Layer.buildWithScope(privates.get(ref, "k"), borrower).pipe(Effect.forkChild)
      yield* Deferred.await(started)

      yield* locations.invalidate(ref)
      expect(yield* privates.has(ref, "k")).toBe(false)
      const fresh = lifecycle(yield* boot(privates.get(ref, "k")))
      yield* Deferred.succeed(release, undefined)
      const detached = lifecycle(yield* Fiber.join(stale))

      expect(state.attempts).toBe(2)
      expect(detached.isClosed()).toBe(true)
      expect(fresh.isClosed()).toBe(false)
      expect(yield* privates.has(ref, "k")).toBe(true)
      yield* Scope.close(borrower, Exit.void)
      expect(yield* privates.has(ref, "k")).toBe(true)
      expect(fixture.state).toEqual({ opened: 2, closed: 1 })
    }),
  )

  it.live("reports each cached Location once by its canonical ref", () =>
    Effect.gen(function* () {
      const [shared, privateOnly] = [yield* locationAt(), yield* locationAt()]
      const fixture = host()
      const locations = Context.get(yield* Layer.build(fixture.layer), LocationServiceMap.Service)
      const privates = yield* register(locations, plain)
      const trailing = Location.Ref.make({ directory: AbsolutePath.make(`${shared.directory}/`) })
      yield* boot(locations.get(trailing))
      yield* boot(privates.get(shared, "a"))
      yield* boot(privates.get(privateOnly, "a"))

      const keys = yield* locations.keys
      expect(keys).toHaveLength(2)
      expect(keys).toContainEqual(LocationServiceMap.canonical(shared))
      expect(keys).toContainEqual(LocationServiceMap.canonical(privateOnly))
      expect(yield* locations.has(trailing)).toBe(true)
      expect(yield* locations.has(privateOnly)).toBe(true)
      expect(yield* privates.has(privateOnly, "b")).toBe(false)
      // Location lookups answer with the default instance only.
      expect(Option.isNone(yield* Effect.scoped(locations.contextEffectOption(privateOnly)))).toBe(true)
    }),
  )

  it.live("interrupts a detached in-flight configure build when the host closes", () =>
    Effect.gen(function* () {
      const ref = yield* locationAt()
      const fixture = host()
      const owner = yield* Scope.make()
      const locations = Context.get(yield* Layer.buildWithScope(fixture.layer, owner), LocationServiceMap.Service)
      const started = yield* Deferred.make<void>()
      let finalized = false
      const privates = yield* register(locations, (at, _key, resolved) =>
        Layer.unwrap(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.sync(() => void (finalized = true)))
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never
          }).pipe(Effect.as(Instance.layer(at, { host: resolved }))),
        ),
      )
      const borrower = yield* Scope.make()
      const inflight = yield* Layer.buildWithScope(privates.get(ref, "stuck"), borrower).pipe(Effect.forkChild)
      yield* Deferred.await(started)

      // Detach while configure is still blocked, then close the host before the borrower releases.
      yield* locations.invalidate(ref)
      yield* Scope.close(owner, Exit.void)
      const exit = yield* Fiber.await(inflight)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(finalized).toBe(true)
      yield* Scope.close(borrower, Exit.void)
    }),
  )
})
