import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Layer, LayerMap, Stream } from "effect"
import { TestClock } from "effect/testing"
import { define } from "@opencode/plugin/effect/plugin"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Agent } from "@opencode/core/agent"
import { Command } from "@opencode/core/command"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { WorkspaceID } from "@opencode/schema/workspace-id"
import { Database } from "../../src/database/database"
import { Bus } from "../../src/bus"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { advance } from "../lib/clock"
import { testEffect } from "../lib/effect"

const id = Plugin.ID.make("account-prompts")

// Host and instance plugins share one ID; each registers a distinct command so the winner is observable.
const greeter = (command: string, plugin: string = id) =>
  define({
    id: plugin,
    effect: (ctx) =>
      ctx.command.transform((editor) => editor.add({ name: command, execute: () => Effect.void })).pipe(Effect.asVoid),
  })

// Every supervisor activation scans the config plugin operations once, so counting scans counts activations.
const source: { activations: number; operations: ConfigPluginSource.Operation[] } = { activations: 0, operations: [] }
const sourceLayer = Layer.succeed(
  ConfigPluginSource.Service,
  ConfigPluginSource.Service.of({
    operations: () =>
      Effect.sync(() => {
        source.activations++
        return source.operations
      }),
    changes: () => Stream.never,
  }),
)

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        Instance.layer(ref, { discovery: false, plugins: [greeter("instance-greet")], replacements: bindings }),
      { idleTimeToLive: Duration.infinity },
    )
    const bindings: LayerNode.Replacements = [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      ConfigPluginSource.node.replace(sourceLayer),
      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      Instance.node.replace(
        Layer.succeed(Instance.Service, {
          provide: (session) => Effect.provide(map.get(session.location)),
        }),
      ),
    ]
    return map
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    LocationServiceMap.node.replace(instances),
  ]),
)

describe("PluginSupervisor", () => {
  it.live("reports a duplicate plugin ID as a failure without dropping the generation", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(greeter("host-greet"))
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const state = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        const commands = yield* Command.Service
        return {
          inventory: yield* plugins.list(),
          host: yield* commands.get("host-greet"),
          instance: yield* commands.get("instance-greet"),
        }
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )

      // Earlier boot order wins: the host SDK plugin activates and the instance copy is reported.
      expect(state.inventory.filter((plugin) => plugin.id === id)).toEqual([
        { id, source: { type: "sdk" }, state: { status: "active" }, features: { server: true } },
        {
          id,
          source: { type: "sdk" },
          state: { status: "failed", error: `Duplicate plugin ID: ${id}` },
          features: { server: true },
        },
      ])
      expect(state.host).toBeDefined()
      expect(state.instance).toBeUndefined()
      // Builtins stay active: the duplicate is a plugin failure, not a generation defect.
      expect(
        state.inventory.some((plugin) => plugin.id?.startsWith("opencode.") && plugin.state.status === "active"),
      ).toBe(true)
    }),
  )

  it.effect("activates the initial generation without waiting for the reload debounce", () =>
    Effect.gen(function* () {
      source.activations = 0
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        // The TestClock never advances here, so any timer between boot and the first activation would hang this.
        yield* plugins.awaitActivation
        expect(yield* commands.get("instance-greet")).toBeDefined()
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(source.activations).toBe(1)
    }),
  )

  it.effect("refreshes every 24 hours without adding an immediate reload", () =>
    Effect.gen(function* () {
      source.activations = 0
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        yield* TestClock.adjust("23 hours")
        expect(source.activations).toBe(1)

        yield* TestClock.adjust("1 hour")
        yield* advance(() => source.activations === 2)
        yield* plugins.awaitActivation

        yield* TestClock.adjust("24 hours")
        yield* advance(() => source.activations === 3)
        yield* plugins.awaitActivation
        expect(source.activations).toBe(3)
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
    }),
  )

  it.effect("reloads for a trigger published while the initial generation is activating", () =>
    Effect.gen(function* () {
      source.activations = 0
      const sdk = yield* SdkPlugins.Service
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      yield* sdk.register(
        define({
          id: "gated",
          effect: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate))),
        }),
      )
      let late = false
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        yield* Deferred.await(entered)
        // Generation 0 is mid-setup: the reload feed must already be subscribed for this update to count.
        yield* sdk.register(
          define({
            id: "late",
            effect: (ctx) =>
              ctx.command
                .transform((editor) => editor.add({ name: "late-greet", execute: () => Effect.void }))
                .pipe(Effect.tap(() => Effect.sync(() => (late = true)))),
          }),
        )
        yield* Deferred.succeed(gate, undefined)
        yield* advance(() => late)
        yield* plugins.awaitActivation
        expect(yield* commands.get("late-greet")).toBeDefined()
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(source.activations).toBe(2)
    }),
  )

  for (const targets of [["opencode.config.policy", "opencode.provider.opencode", "opencode.config.agent"], ["*"]]) {
    it.effect(`keeps policy enforcement and the Console connection through plugin removals: ${targets}`, () =>
      Effect.gen(function* () {
        source.operations = targets.map((target) => ({ type: "remove", target }))
        const directory = yield* tmpdirScoped()
        const locations = yield* LocationServiceMap.Service
        const inventory = yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          return yield* plugins.list()
        }).pipe(
          Effect.scoped,
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        )
        const status = (id: string) => inventory.find((plugin) => plugin.id === id)?.state.status
        expect(status("opencode.config.policy")).toBe("active")
        expect(status("opencode.provider.opencode")).toBe("active")
        // Removals still apply to everything else, including instance and builtin plugins.
        expect(status("opencode.config.agent")).toBeUndefined()
        expect(inventory.some((plugin) => plugin.id === id)).toBe(targets[0] !== "*")
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            source.operations = []
          }),
        ),
      ),
    )
  }

  it.effect("coalesces a burst of reload triggers after the initial generation into one activation", () =>
    Effect.gen(function* () {
      source.activations = 0
      const sdk = yield* SdkPlugins.Service
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        yield* plugins.awaitActivation
        expect(source.activations).toBe(1)

        yield* sdk.register(greeter("greet-a", "a"))
        yield* sdk.register(greeter("greet-b", "b"))
        yield* sdk.register(greeter("greet-c", "c"))
        yield* advance(() => source.activations > 1)
        yield* plugins.awaitActivation
        expect(yield* commands.get("greet-a")).toBeDefined()
        expect(yield* commands.get("greet-c")).toBeDefined()
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(source.activations).toBe(2)
    }),
  )

  it.effect("reloads all booted locations when sdk.register is called inside a location context", () =>
    Effect.gen(function* () {
      source.activations = 0
      const sdk = yield* SdkPlugins.Service
      const dirA = yield* tmpdirScoped()
      const dirB = yield* tmpdirScoped()
      const refA = Location.Ref.make({ directory: AbsolutePath.make(dirA.path) })
      const refB = Location.Ref.make({ directory: AbsolutePath.make(dirB.path) })
      const locations = yield* LocationServiceMap.Service

      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
      }).pipe(Effect.provide(locations.get(refA)))

      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
      }).pipe(Effect.provide(locations.get(refB)))

      expect(source.activations).toBe(2)

      yield* sdk
        .register(greeter("greet-cross-location", "cross-location"))
        .pipe(Effect.provide(locations.get(refA)))

      yield* advance(() => source.activations === 4)

      for (const ref of [refA, refB]) {
        const command = yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const commands = yield* Command.Service
          yield* plugins.awaitActivation
          return yield* commands.get("greet-cross-location")
        }).pipe(Effect.provide(locations.get(ref)))
        expect(command).toBeDefined()
      }
    }),
  )

  it.effect("scopes external plugin event subscriptions and async catalog reloads to the plugin's location", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      const bus = yield* Bus.Service
      const dirA = yield* tmpdirScoped()
      const dirB = yield* tmpdirScoped()
      const refA = Location.Ref.make({
        directory: AbsolutePath.make(dirA.path),
        workspaceID: WorkspaceID.make("wrk_a"),
      })
      const refSameDirOtherWorkspace = Location.Ref.make({
        directory: AbsolutePath.make(dirA.path),
        workspaceID: WorkspaceID.make("wrk_b"),
      })
      const refB = Location.Ref.make({ directory: AbsolutePath.make(dirB.path) })
      const locations = yield* LocationServiceMap.Service
      const observedByA: Array<string> = []
      const observedBySameDirOtherWorkspace: Array<string> = []
      const publishedLocations: Array<Location.Ref | undefined> = []
      let step = 0

      yield* bus
        .subscribe(Command.Event.Updated)
        .pipe(
          Stream.runForEach((event) => Effect.sync(() => publishedLocations.push(event.location))),
          Effect.forkScoped({ startImmediately: true }),
        )

      yield* sdk.register(
        define({
          id: "location-scoped-observer",
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.command.transform((editor) => {
                editor.add({ name: `cmd-${++step}`, execute: () => Effect.void })
              })
              if (ctx.location.directory !== refA.directory) return
              const target =
                ctx.location.workspaceID === refA.workspaceID ? observedByA : observedBySameDirOtherWorkspace
              yield* ctx.event.subscribe().pipe(
                Stream.runForEach((event) => {
                  if (event.type !== "agent.updated") return Effect.void
                  target.push(
                    event.location ? `${event.location.directory}:${event.location.workspaceID ?? ""}` : "global",
                  )
                  return ctx.command.reload()
                }),
                Effect.forkScoped({ startImmediately: true }),
              )
            }),
        }),
      )

      for (const ref of [refA, refSameDirOtherWorkspace, refB]) {
        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
        }).pipe(Effect.provide(locations.get(ref)))
      }
      yield* Effect.yieldNow

      observedByA.length = 0
      observedBySameDirOtherWorkspace.length = 0
      publishedLocations.length = 0
      yield* bus.publish(Agent.Event.Updated, {}, { location: refB })
      yield* Effect.yieldNow
      expect(observedByA).toEqual([])
      expect(observedBySameDirOtherWorkspace).toEqual([])
      expect(publishedLocations).toEqual([])

      yield* bus.publish(Agent.Event.Updated, {}, { location: refSameDirOtherWorkspace })
      yield* Effect.yieldNow
      expect(observedByA).toEqual([])
      expect(observedBySameDirOtherWorkspace).toEqual([`${refA.directory}:wrk_b`])
      expect(publishedLocations).toEqual([refSameDirOtherWorkspace])

      observedBySameDirOtherWorkspace.length = 0
      publishedLocations.length = 0
      yield* bus.publish(Agent.Event.Updated, {}, { location: refA })
      yield* Effect.yieldNow
      expect(observedByA).toEqual([`${refA.directory}:wrk_a`])
      expect(observedBySameDirOtherWorkspace).toEqual([])
      expect(publishedLocations).toEqual([refA])

      observedByA.length = 0
      observedBySameDirOtherWorkspace.length = 0
      publishedLocations.length = 0
      yield* bus.publish(Agent.Event.Updated, {}, { global: true })
      yield* Effect.yieldNow
      expect(observedByA).toEqual(["global"])
      expect(observedBySameDirOtherWorkspace).toEqual(["global"])
      expect(publishedLocations).toHaveLength(2)
      expect(publishedLocations).toContainEqual(refA)
      expect(publishedLocations).toContainEqual(refSameDirOtherWorkspace)
    }),
  )
})
