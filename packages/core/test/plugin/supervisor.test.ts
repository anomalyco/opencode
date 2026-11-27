import { describe, expect } from "bun:test"
import path from "path"
import { Clock, Deferred, Duration, Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { define } from "@opencode/plugin/effect/plugin"
import { Event } from "@opencode/schema/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { AISDK } from "@opencode/core/aisdk"
import { Command } from "@opencode/core/command"
import { Config } from "@opencode/core/config"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Instance } from "@opencode/core/instance"
import { LocationServiceMap, buildLocationServiceMap } from "@opencode/core/location-services"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { PluginUpdate } from "@opencode/core/plugin/update"
import { AbsolutePath } from "@opencode/core/schema"
import { Database } from "../../src/database/database"
import { Bus } from "../../src/bus"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { advance, drain } from "../lib/clock"
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
const source: { activations: number; operations: ConfigPluginSource.Operation[]; fail?: Error } = {
  activations: 0,
  operations: [],
}
const sourceLayer = Layer.succeed(
  ConfigPluginSource.Service,
  ConfigPluginSource.Service.of({
    operations: () =>
      Effect.suspend(() => {
        source.activations++
        if (source.fail) return Effect.die(source.fail)
        return Effect.succeed(source.operations)
      }),
    changes: () => Stream.never,
  }),
)

// Package checks report `available` after `delay`, and packages in `stays` don't follow updates; updates are recorded
// instead of installed.
const packages = { available: false, delay: Duration.zero, checks: 0, stays: [] as string[], updated: [] as string[] }

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LocationServiceMap.make(
      (ref: Location.Ref) =>
        Instance.layer(ref, { discovery: false, plugins: [greeter("instance-greet")], replacements: bindings }),
      { idleTimeToLive: Duration.infinity },
    )
    const bindings: LayerNode.Replacements = [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      ConfigPluginSource.node.replace(sourceLayer),
      Npm.node.replace(
        Layer.succeed(
          Npm.Service,
          Npm.Service.of({
            add: (pkg) =>
              Effect.fail(
                new Npm.InstallFailedError({
                  add: [pkg],
                  dir: "",
                  cause: new Error(`Unexpected Npm.add(${pkg})`),
                }),
              ),
            resolve: (name) => Effect.succeed({ directory: "", name }),
            check: () =>
              Effect.sleep(packages.delay).pipe(
                Effect.andThen(Effect.sync(() => packages.checks++)),
                Effect.as(packages.available),
              ),
            update: (pkg) =>
              packages.available
                ? Effect.sync(() => {
                    packages.updated.push(pkg)
                    return { directory: "", name: pkg }
                  })
                : Effect.fail(
                    new Npm.InstallFailedError({
                      add: [pkg],
                      dir: "",
                      cause: new Error(`Unexpected Npm.update(${pkg})`),
                    }),
                  ),
            follows: (pkg) => Effect.succeed(!packages.stays.includes(pkg)),
            reject: () => Effect.succeed(false),
            which: () => Effect.undefined,
          }),
        ),
      ),
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

  it.effect("updates only packages that follow updates, once per check interval", () =>
    Effect.gen(function* () {
      const follows = ["latest-plugin@latest", "ranged-plugin@^1.0.0", "github:acme/branch-plugin#dev"]
      packages.stays = ["plain-plugin", "next-plugin@next", "github:acme/default-plugin"]
      source.operations = [...follows, ...packages.stays].map((target) => ({
        type: "add" as const,
        target,
        options: {},
      }))
      packages.available = true
      packages.updated = []
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        yield* Plugin.Service
        yield* advance(() => packages.updated.length >= follows.length)
        // Each update reloads and checks again; the newer version is still reported but isn't installed twice.
        yield* drain
        expect(packages.updated.toSorted()).toEqual(follows.toSorted())
        // The next interval's scheduled check installs again.
        yield* TestClock.adjust(PluginUpdate.interval)
        yield* advance(() => packages.updated.length >= follows.length * 2)
        yield* drain
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        Effect.ensuring(
          Effect.sync(() => {
            source.operations = []
            packages.available = false
            packages.stays = []
          }),
        ),
      )
      expect(packages.updated.toSorted()).toEqual([...follows, ...follows].toSorted())
    }),
  )

  it.effect("checks and updates once per interval, 24 hours after a slow startup", () =>
    Effect.gen(function* () {
      source.operations = [{ type: "add", target: "latest-plugin@latest", options: {} }]
      packages.available = true
      // Checks take a while, so the first ones finish well after startup.
      packages.delay = Duration.seconds(10)
      packages.checks = 0
      packages.updated = []
      source.activations = 0
      const sdk = yield* SdkPlugins.Service
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const started = yield* Clock.currentTimeMillis
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* advance(() => packages.updated.length === 1)
        // The update reloads and checks again; the newer version is still reported but isn't installed twice.
        yield* drain
        yield* plugins.awaitActivation
        expect(packages.updated).toEqual(["latest-plugin@latest"])
        // Other reloads in the same interval reuse the checks.
        const checks = packages.checks
        const activations = source.activations
        yield* sdk.register(greeter("interval-greet", "interval"))
        yield* advance(() => source.activations > activations)
        yield* drain
        yield* plugins.awaitActivation
        expect(packages.checks).toBe(checks)
        expect(packages.updated).toHaveLength(1)
        // The scheduled check exactly one interval after startup checks and installs again.
        yield* TestClock.adjust(started + PluginUpdate.interval - (yield* Clock.currentTimeMillis))
        yield* advance(() => packages.updated.length === 2)
        yield* drain
        expect(packages.checks).toBeGreaterThan(checks)
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        Effect.ensuring(
          Effect.sync(() => {
            source.operations = []
            packages.available = false
            packages.delay = Duration.zero
          }),
        ),
      )
      expect(packages.updated).toEqual(["latest-plugin@latest", "latest-plugin@latest"])
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

      yield* sdk.register(greeter("greet-cross-location", "cross-location")).pipe(Effect.provide(locations.get(refA)))

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

  it.effect("runs SDK plugin aisdk.sdk hooks before the dynamic npm fallback", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      const providerID = Provider.ID.make("cloudflare")
      const fakeLanguageModel: LanguageModelV3 = {
        specificationVersion: "v3",
        provider: "cloudflare",
        modelId: "workers-ai",
        supportedUrls: {},
        doGenerate: () => Promise.reject(new Error("unused")),
        doStream: () => Promise.reject(new Error("unused")),
      }
      yield* sdk.register(
        define({
          id: "cloudflare.aisdk",
          effect: (ctx) =>
            ctx.aisdk
              .hook(
                "sdk",
                (evt) => {
                  if (evt.package !== "agents/models/opencode") return Effect.void
                  evt.sdk = { languageModel: () => fakeLanguageModel }
                  return Effect.void
                },
                { providerID },
              )
              .pipe(Effect.asVoid),
        }),
      )
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const language = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* plugins.awaitActivation
        return yield* aisdk.language(
          Model.Info.make({
            ...Model.Info.default(providerID, Model.ID.make("workers-ai")),
            modelID: Model.ID.make("workers-ai"),
            package: "aisdk:agents/models/opencode",
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(language).toBe(fakeLanguageModel)
    }),
  )

  it.effect("keeps builtins active and reports an error when initial activation fails", () =>
    Effect.gen(function* () {
      source.activations = 0
      source.fail = new Error("broken plugin config")
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const result = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const providers = yield* Provider.Service
        const commands = yield* Command.Service
        yield* plugins.awaitActivation
        return {
          inventory: yield* plugins.list(),
          providers: yield* providers.all(),
          command: yield* commands.get("instance-greet"),
        }
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        Effect.ensuring(Effect.sync(() => (source.fail = undefined))),
      )

      expect(result.providers.length).toBeGreaterThan(0)
      expect(result.command).toBeDefined()
      expect(result.inventory).toContainEqual(
        expect.objectContaining({
          source: { type: "builtin" },
          state: expect.objectContaining({
            status: "failed",
            error: expect.stringContaining("broken plugin config"),
            ref: expect.stringMatching(/^err_/),
          }),
        }),
      )
    }),
  )

  testEffect(Layer.empty).live("keeps a disabled builtin provider off when initial activation fails", () =>
    Effect.gen(function* () {
      source.activations = 0
      source.fail = new Error("broken plugin config")
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory.path, ".opencode/opencode.json"),
          JSON.stringify({ plugins: ["-opencode.provider.ollama"] }),
        ),
      )
      const layer = AppNodeBuilder.build(
        LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]),
        [
          Global.node.replace(tempGlobalLayer),
          offlineModels,
          LocationServiceMap.node.replace(
            buildLocationServiceMap([
              Global.node.replace(tempGlobalLayer),
              offlineModels,
              ConfigPluginSource.node.replace(sourceLayer),
            ]),
          ),
        ],
      )
      const inventory = yield* Effect.gen(function* () {
        const locations = yield* LocationServiceMap.Service
        return yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          return yield* plugins.list()
        }).pipe(
          Effect.scoped,
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        )
      }).pipe(Effect.provide(layer), Effect.scoped, Effect.ensuring(Effect.sync(() => (source.fail = undefined))))

      const status = (pluginID: string) => inventory.find((plugin) => plugin.id === pluginID)?.state.status
      expect(status("opencode.provider.ollama")).toBeUndefined()
      expect(status("opencode.provider.opencode")).toBe("active")
      expect(status("opencode.config.policy")).toBe("active")
      expect(status("opencode.provider.openai")).toBe("active")
      expect(inventory).toContainEqual(
        expect.objectContaining({
          source: { type: "builtin" },
          state: expect.objectContaining({
            status: "failed",
            error: expect.stringContaining("broken plugin config"),
            ref: expect.stringMatching(/^err_/),
          }),
        }),
      )
    }),
  )

  testEffect(Layer.empty).live("falls back only to guarded builtins when config cannot be read on boot", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      let failConfig = false
      const brokenConfigLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]),
        [
          Global.node.replace(tempGlobalLayer),
          offlineModels,
          LocationServiceMap.node.replace(
            buildLocationServiceMap([
              Global.node.replace(tempGlobalLayer),
              offlineModels,
              Config.node.replace(
                Layer.succeed(
                  Config.Service,
                  Config.Service.of({
                    entries: () =>
                      Effect.suspend(() =>
                        failConfig ? Effect.die(new Error("unreadable config")) : Effect.succeed([]),
                      ),
                    changes: () => Stream.never,
                  }),
                ),
              ),
              ConfigPluginSource.node.replace(
                Layer.succeed(
                  ConfigPluginSource.Service,
                  ConfigPluginSource.Service.of({
                    operations: () =>
                      Effect.suspend(() => {
                        failConfig = true
                        return Effect.die(new Error("unreadable config"))
                      }),
                    changes: () => Stream.never,
                  }),
                ),
              ),
            ]),
          ),
        ],
      )
      const inventory = yield* Effect.gen(function* () {
        const locations = yield* LocationServiceMap.Service
        return yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          return yield* plugins.list()
        }).pipe(
          Effect.scoped,
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        )
      }).pipe(Effect.provide(brokenConfigLayer), Effect.scoped)

      const loadedIDs = inventory.flatMap((plugin) => (plugin.id ? [plugin.id] : []))
      expect(loadedIDs).toEqual([
        Plugin.ID.make("opencode.provider.opencode"),
        Plugin.ID.make("opencode.config.policy"),
      ])
      expect(inventory).toContainEqual(
        expect.objectContaining({
          source: { type: "builtin" },
          state: expect.objectContaining({
            status: "failed",
            error: expect.stringContaining("unreadable config"),
            ref: expect.stringMatching(/^err_/),
          }),
        }),
      )
    }),
  )

  it.effect("keeps the previous working plugin set and reports the error when a reload fails", () =>
    Effect.gen(function* () {
      source.activations = 0
      source.fail = undefined
      const bus = yield* Bus.Service
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const providers = yield* Provider.Service
        const commands = yield* Command.Service
        yield* plugins.awaitActivation
        const beforeProviders = (yield* providers.all()).length
        expect(beforeProviders).toBeGreaterThan(0)
        expect(yield* commands.get("instance-greet")).toBeDefined()

        let updated = 0
        yield* Effect.acquireRelease(
          bus.listen((event) => Effect.sync(() => void (event.type === Plugin.Event.Updated.type && updated++))),
          (unsubscribe) => unsubscribe,
        )

        source.fail = new Error("reload boom")
        const activations = source.activations
        yield* bus.publish(Event.Updated, {})
        yield* advance(() => source.activations > activations)
        yield* plugins.awaitActivation

        expect((yield* providers.all()).length).toBe(beforeProviders)
        expect(yield* commands.get("instance-greet")).toBeDefined()
        expect(updated).toBeGreaterThan(0)
        expect(yield* plugins.list()).toContainEqual(
          expect.objectContaining({
            source: { type: "builtin" },
            state: expect.objectContaining({
              status: "failed",
              error: expect.stringContaining("reload boom"),
              ref: expect.stringMatching(/^err_/),
            }),
          }),
        )

        // Fixing the error and reloading clears the reported failure.
        source.fail = undefined
        const nextActivations = source.activations
        yield* bus.publish(Event.Updated, {})
        yield* advance(() => source.activations > nextActivations)
        yield* plugins.awaitActivation

        expect((yield* plugins.list()).filter((plugin) => plugin.state.status === "failed")).toEqual([])
        expect((yield* providers.all()).length).toBe(beforeProviders)
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        Effect.ensuring(Effect.sync(() => (source.fail = undefined))),
      )
    }),
  )

  const bootInventory = (
    plugins: readonly (string | { package: string; options?: Record<string, unknown> })[],
    fail?: Error,
  ) =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        Bun.write(path.join(directory.path, ".opencode/opencode.json"), JSON.stringify({ plugins })),
      )
      const locationReplacements: LayerNode.Replacements = [
        Global.node.replace(tempGlobalLayer),
        offlineModels,
        ...(fail
          ? [
              ConfigPluginSource.node.replace(
                Layer.succeed(
                  ConfigPluginSource.Service,
                  ConfigPluginSource.Service.of({
                    operations: () => Effect.die(fail),
                    changes: () => Stream.never,
                  }),
                ),
              ),
            ]
          : []),
      ]
      const layer = AppNodeBuilder.build(
        LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]),
        [
          Global.node.replace(tempGlobalLayer),
          offlineModels,
          LocationServiceMap.node.replace(buildLocationServiceMap(locationReplacements)),
        ],
      )
      return yield* Effect.gen(function* () {
        const locations = yield* LocationServiceMap.Service
        return yield* Effect.gen(function* () {
          const pluginService = yield* Plugin.Service
          yield* pluginService.awaitActivation
          return yield* pluginService.list()
        }).pipe(
          Effect.scoped,
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        )
      }).pipe(Effect.provide(layer), Effect.scoped)
    })

  const activeIDs = (inventory: readonly Plugin.Info[]) =>
    inventory.flatMap((plugin) => (plugin.state.status === "active" && plugin.id ? [plugin.id] : []))

  testEffect(Layer.empty).live(
    "agrees between normal activation and first-activation fallback when disabling a builtin provider",
    () =>
      Effect.gen(function* () {
        const plugins = ["-opencode.provider.ollama"] as const
        const normal = yield* bootInventory(plugins)
        const fallback = yield* bootInventory(plugins, new Error("broken plugin config"))

        const normalActive = activeIDs(normal)
        const fallbackActive = activeIDs(fallback)
        expect(fallbackActive).toEqual(normalActive)
        expect(normalActive).not.toContain(Plugin.ID.make("opencode.provider.ollama"))
        expect(normalActive).toContain(Plugin.ID.make("opencode.provider.openai"))
        expect(normalActive).toContain(Plugin.ID.make("opencode.provider.opencode"))
        expect(normalActive).toContain(Plugin.ID.make("opencode.config.policy"))
        expect(fallback).toContainEqual(
          expect.objectContaining({
            source: { type: "builtin" },
            state: expect.objectContaining({
              status: "failed",
              error: expect.stringContaining("broken plugin config"),
              ref: expect.stringMatching(/^err_/),
            }),
          }),
        )
      }),
  )

  testEffect(Layer.empty).live(
    "agrees between normal activation and first-activation fallback for .* prefix matching and object entries",
    () =>
      Effect.gen(function* () {
        const plugins = ["-opencode.provider.*", { package: "opencode.provider.openai" }] as const
        const normal = yield* bootInventory(plugins)
        const fallback = yield* bootInventory(plugins, new Error("broken plugin config"))

        const normalActive = activeIDs(normal)
        const fallbackActive = activeIDs(fallback)
        expect(fallbackActive).toEqual(normalActive)
        expect(normalActive).not.toContain(Plugin.ID.make("opencode.provider.ollama"))
        expect(normalActive).toContain(Plugin.ID.make("opencode.provider.openai"))
        expect(normalActive).toContain(Plugin.ID.make("opencode.provider.opencode"))
        expect(normalActive).toContain(Plugin.ID.make("opencode.config.agent"))
        expect(fallback).toContainEqual(
          expect.objectContaining({
            source: { type: "builtin" },
            state: expect.objectContaining({
              status: "failed",
              error: expect.stringContaining("broken plugin config"),
              ref: expect.stringMatching(/^err_/),
            }),
          }),
        )
      }),
  )

  testEffect(Layer.empty).live(
    "agrees between normal activation and first-activation fallback for * removal and guarded builtins",
    () =>
      Effect.gen(function* () {
        const plugins = [
          "-*",
          "-opencode.config.policy",
          "-opencode.provider.opencode",
          "opencode.provider.openai",
        ] as const
        const normal = yield* bootInventory(plugins)
        const fallback = yield* bootInventory(plugins, new Error("broken plugin config"))

        const normalActive = activeIDs(normal)
        const fallbackActive = activeIDs(fallback)
        expect(fallbackActive).toEqual(normalActive)
        expect(normalActive.toSorted()).toEqual([
          Plugin.ID.make("opencode.config.policy"),
          Plugin.ID.make("opencode.provider.openai"),
          Plugin.ID.make("opencode.provider.opencode"),
        ])
        expect(fallback).toContainEqual(
          expect.objectContaining({
            source: { type: "builtin" },
            state: expect.objectContaining({
              status: "failed",
              error: expect.stringContaining("broken plugin config"),
              ref: expect.stringMatching(/^err_/),
            }),
          }),
        )
      }),
  )

  testEffect(Layer.empty).live(
    "skips a lone '-' entry in first-activation fallback without discarding other config operations or builtins",
    () =>
      Effect.gen(function* () {
        const normal = yield* bootInventory(["-opencode.provider.*", "opencode.provider.openai"])
        const fallback = yield* bootInventory(["-opencode.provider.*", "-", "opencode.provider.openai"])

        const normalActive = activeIDs(normal)
        const fallbackActive = activeIDs(fallback)
        expect(fallbackActive).toEqual(normalActive)
        expect(fallbackActive).not.toContain(Plugin.ID.make("opencode.provider.ollama"))
        expect(fallbackActive).toContain(Plugin.ID.make("opencode.provider.openai"))
        expect(fallbackActive).toContain(Plugin.ID.make("opencode.provider.opencode"))
        expect(fallbackActive).toContain(Plugin.ID.make("opencode.config.policy"))
        expect(fallbackActive).toContain(Plugin.ID.make("opencode.config.agent"))
        expect(fallback).toContainEqual(
          expect.objectContaining({
            source: { type: "builtin" },
            state: expect.objectContaining({
              status: "failed",
              error: expect.stringContaining("Plugin remove operation requires a target"),
              ref: expect.stringMatching(/^err_/),
            }),
          }),
        )
      }),
  )
})
