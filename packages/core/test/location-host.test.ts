import { describe, expect } from "bun:test"
import { Cause, Context, Effect, Exit, Layer } from "effect"
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
  it.live("does not build Location globals for a graph that never reaches the Location map", () =>
    Effect.gen(function* () {
      const api = codeModeApi(() => Effect.void)
      yield* Layer.build(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), api.replacements))
      expect(api.state.acquired).toBe(0)
    }),
  )

  it.live("builds Location globals once with the host, and every Location reads them", () =>
    Effect.gen(function* () {
      // Create temp directories before building the host so their cleanup runs after Locations close.
      const [first, second] = [yield* locationAt(), yield* locationAt()]
      const api = codeModeApi(() => Effect.void)
      const context = yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements))
      expect(api.state.acquired).toBe(1)
      const locations = Context.get(context, LocationServiceMap.Service)
      const directory = (ref: Location.Ref) =>
        Location.Service.pipe(
          Effect.provide(locations.get(ref)),
          Effect.scoped,
          Effect.map((info) => info.directory),
        )

      expect(yield* directory(first)).toBe(first.directory)
      expect(yield* directory(second)).toBe(second.directory)
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
      const exit = yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements)).pipe(
        Effect.scoped,
        Effect.exit,
      )
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("still building globals")
    }),
  )

  it.live("fails the host context when Stage 1 fails", () =>
    Effect.gen(function* () {
      const api = codeModeApi(() => Effect.die(new Error("stage 1 broke")))
      const exit = yield* Layer.build(AppNodeBuilder.build(LocationServiceMap.node, api.replacements)).pipe(
        Effect.scoped,
        Effect.exit,
      )
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("stage 1 broke")
      const host = yield* Effect.exit(api.state.locations?.host ?? Effect.die(new Error("no host")))
      expect(Exit.isFailure(host) && Cause.pretty(host.cause)).toContain("stage 1 broke")
    }),
  )
})
