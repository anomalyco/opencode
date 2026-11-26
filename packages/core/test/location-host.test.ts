import { describe, expect } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Layer, Scope } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { CodeModeApi } from "@opencode/core/codemode/api"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Instance } from "@opencode/core/instance"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/core/schema"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

// CodeModeApi is a global every Location reaches but no host root below does: only Stage 1 builds it.
function codeModeApi(build: (locations: LocationServiceMap.Interface) => Effect.Effect<void>) {
  const state = { acquired: 0, locations: undefined as LocationServiceMap.Interface | undefined }
  const replacement = CodeModeApi.node.replace(
    makeGlobalNode({
      service: CodeModeApi.Service,
      layer: Layer.unwrap(
        Effect.gen(function* () {
          state.acquired++
          state.locations = yield* LocationServiceMap.Service
          yield* build(state.locations)
          return Layer.succeed(CodeModeApi.Service, CodeModeApi.unavailable)
        }),
      ),
      deps: [LocationServiceMap.node],
    }),
  )
  return {
    state,
    replacements: [
      Global.node.replace(tempGlobalLayer),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      offlineModels,
      replacement,
    ],
  }
}

const locationAt = Effect.fn(function* () {
  const dir = yield* tmpdirScoped()
  return Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
})

describe("location host", () => {
  it.live("does not build Location globals until a Location actually boots", () =>
    Effect.gen(function* () {
      const api = codeModeApi(() => Effect.void)
      yield* Layer.build(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), api.replacements))
      expect(api.state.acquired).toBe(0)
      yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements))
      expect(api.state.acquired).toBe(0)
    }),
  )

  it.live("builds Location globals once on first Location boot, and every Location reads them across reloads", () =>
    Effect.gen(function* () {
      // Create temp directories before building the host so their cleanup runs after Locations close.
      const [first, second] = [yield* locationAt(), yield* locationAt()]
      const api = codeModeApi(() => Effect.void)
      const context = yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements))
      expect(api.state.acquired).toBe(0)
      const locations = Context.get(context, LocationServiceMap.Service)
      const directory = (ref: Location.Ref) =>
        Location.Service.pipe(
          Effect.provide(locations.get(ref)),
          Effect.scoped,
          Effect.map((info) => info.directory),
        )

      expect(yield* Effect.all([directory(first), directory(second)], { concurrency: "unbounded" })).toEqual([
        first.directory,
        second.directory,
      ])
      expect(api.state.acquired).toBe(1)
      yield* locations.invalidate(first)
      expect(yield* directory(first)).toBe(first.directory)
      expect(api.state.acquired).toBe(1)
    }),
  )

  it.live("rejects global replacements passed to Instance.layer alongside a host", () =>
    Effect.gen(function* () {
      const ref = yield* locationAt()
      const api = codeModeApi(() => Effect.void)
      const context = yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements))
      const locations = Context.get(context, LocationServiceMap.Service)
      const host = yield* locations.host ?? Effect.die(new Error("no host"))
      expect(() =>
        Instance.layer(ref, {
          host,
          replacements: [CodeModeApi.node.replace(Layer.succeed(CodeModeApi.Service, CodeModeApi.unavailable))],
        }),
      ).toThrow("Cannot replace @opencode/CodeModeApi in a child graph")
    }),
  )

  it.live("fails a synchronous Location boot from inside Stage 1 instead of deadlocking", () =>
    Effect.gen(function* () {
      const ref = yield* locationAt()
      const api = codeModeApi((locations) =>
        Effect.scoped(locations.contextEffect(ref)).pipe(Effect.orDie, Effect.asVoid),
      )
      const context = yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements))
      const locations = Context.get(context, LocationServiceMap.Service)
      const exit = yield* Effect.scoped(locations.contextEffect(ref)).pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("still building globals")
    }),
  )

  it.live("lets a forked background fiber during Stage 1 await hostContext instead of failing", () =>
    Effect.gen(function* () {
      const ref = yield* locationAt()
      const result = yield* Deferred.make<AbsolutePath>()
      const api = codeModeApi((locations) =>
        Effect.gen(function* () {
          yield* Effect.scoped(
            locations.contextEffect(ref).pipe(Effect.map((ctx) => Context.get(ctx, Location.Service).directory)),
          ).pipe(
            Effect.flatMap((dir) => Deferred.succeed(result, dir)),
            Effect.forkDetach,
          )
          // Give the forked fiber a turn to hit locations.host before Stage 1 finishes.
          yield* Effect.yieldNow
        }),
      )
      const context = yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements))
      const locations = Context.get(context, LocationServiceMap.Service)
      expect(
        yield* Effect.scoped(
          locations.contextEffect(ref).pipe(Effect.map((ctx) => Context.get(ctx, Location.Service).directory)),
        ),
      ).toBe(ref.directory)
      expect(yield* Deferred.await(result)).toBe(ref.directory)
      expect(api.state.acquired).toBe(1)
    }),
  )

  it.live("fails the host context when Stage 1 fails", () =>
    Effect.gen(function* () {
      const ref = yield* locationAt()
      const api = codeModeApi(() => Effect.die(new Error("stage 1 broke")))
      const context = yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements))
      const locations = Context.get(context, LocationServiceMap.Service)
      const exit = yield* Effect.scoped(locations.contextEffect(ref)).pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("stage 1 broke")
      const host = yield* Effect.exit(locations.host ?? Effect.die(new Error("no host")))
      expect(Exit.isFailure(host) && Cause.pretty(host.cause)).toContain("stage 1 broke")
    }),
  )

  it.live("interrupts host lookup cleanly after the host scope closes", () =>
    Effect.gen(function* () {
      const api = codeModeApi(() => Effect.void)
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(
        AppNodeBuilder.build(LocationServiceMap.node, api.replacements),
        scope,
      )
      const locations = Context.get(context, LocationServiceMap.Service)
      yield* Scope.close(scope, Exit.void)
      const exit = yield* Effect.exit(locations.host ?? Effect.die(new Error("no host")))
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }),
  )
})
