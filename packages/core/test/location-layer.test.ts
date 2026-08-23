import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Config } from "@opencode-ai/schema/config"
import { Money } from "@opencode-ai/schema/money"
import { DateTime, Deferred, Duration, Effect, Equal, Fiber, Hash, Layer, LayerMap, RcMap, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Plugin as EffectPlugin } from "@opencode-ai/plugin/effect"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { LocationServiceMap, type LocationServices } from "@opencode-ai/core/location-services"
import { LocationActivity } from "@opencode-ai/core/location-activity"
import { Location } from "@opencode-ai/core/location"
import { Plugin } from "@opencode-ai/core/plugin"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Model } from "@opencode-ai/core/model"
import { MCP } from "@opencode-ai/core/mcp/index"
import { Project } from "@opencode-ai/core/project"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"
import { toolDefinitions, waitForTool } from "./lib/tool"
import { Database } from "../src/database/database"
import { Bus } from "../src/bus"
import { Reference } from "../src/reference"
import { Tool } from "../src/tool"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node]), [
    [Global.node, tempGlobalLayer],
  ]),
)
const itWithSdk = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    [Global.node, tempGlobalLayer],
  ]),
)
const activityLocations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    (ref) =>
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      Layer.succeed(
        Location.Service,
        Location.Service.of({
          directory: ref.directory,
          workspaceID: ref.workspaceID,
          project: { id: Project.ID.global, directory: ref.directory, canonical: ref.directory },
        }),
      ) as unknown as Layer.Layer<LocationServices>,
    { idleTimeToLive: Duration.infinity },
  ),
)
const itWithActivity = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, LocationServiceMap.node, LocationActivity.node]),
    [[LocationServiceMap.node, activityLocations]],
  ),
)

describe("LocationServiceMap", () => {
  itWithActivity.effect("refreshes lifetime from Session events only", () =>
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      const bus = yield* Bus.Service
      const ref = Location.Ref.make({ directory: AbsolutePath.make("/project") })
      const sessionID = Session.ID.make("ses_location_activity")
      const read = Location.Service.pipe(Effect.provide(locations.get(ref)), Effect.scoped)

      yield* read
      yield* TestClock.adjust("59 minutes")
      yield* bus.publish(Catalog.Event.Updated, {}, { location: ref })
      yield* TestClock.adjust("2 minutes")
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])

      yield* read
      yield* bus.publish(SessionEvent.Execution.Started, { sessionID }, { location: ref })
      yield* TestClock.adjust("59 minutes")
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID }, { location: ref })
      yield* TestClock.adjust("1 minute")
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([ref])
      yield* TestClock.adjust("59 minutes")
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])
    }),
  )

  it.live("retries a location after its missing directory is recreated", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const locations = yield* LocationServiceMap.Service
          const directory = path.join(dir.path, "recreated")
          const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })

          const first = yield* Location.Service.pipe(Effect.provide(locations.get(ref)), Effect.scoped, Effect.exit)
          expect(first._tag).toBe("Failure")

          yield* Effect.promise(() => fs.mkdir(directory))
          const location = yield* Location.Service.pipe(Effect.provide(locations.get(ref)), Effect.scoped)
          expect(location.directory).toBe(ref.directory)
        }),
      ),
    ),
  )

  itWithSdk.live("preserves embedded SDK plugins after Location eviction", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sdk = yield* SdkPlugins.Service
          const locations = yield* LocationServiceMap.Service
          const id = Agent.ID.make("persistent-sdk-agent")
          const plugin = EffectPlugin.define({
            id: "persistent-sdk-plugin",
            effect: (ctx) => ctx.agent.transform((agents) => agents.update(id, () => {})),
          })
          yield* sdk.register(plugin)

          const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const read = Effect.gen(function* () {
            const supervisor = yield* PluginSupervisor.Service
            yield* supervisor.flush
            const agents = yield* Agent.Service
            return yield* agents.get(id)
          })

          expect(yield* read.pipe(Effect.scoped, Effect.provide(locations.get(ref)))).toBeDefined()
          yield* locations.invalidate(ref)
          expect(yield* read.pipe(Effect.scoped, Effect.provide(locations.get(ref)))).toBeDefined()
        }),
      ),
    ),
  )

  itWithSdk.live("waits for explorer activation to complete", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const sdk = yield* SdkPlugins.Service
          yield* sdk.register(
            EffectPlugin.define({
              id: "blocked-initial-activation",
              effect: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
            }),
          )

          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))
          yield* Deferred.await(started)

          const flushFiber = yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(
            Effect.provide(context),
            Effect.forkChild,
          )
          expect(flushFiber.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(flushFiber)
          yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(
            Effect.provide(context),
            Effect.timeout("1 second"),
          )

          const explorer = yield* Effect.gen(function* () {
            const agents = yield* Agent.Service
            return yield* agents.resolve("explore")
          }).pipe(Effect.provide(context))

          expect(explorer).toBeDefined()
          expect(explorer?.permissions.length).toBeGreaterThan(0)
        }),
      ),
    ),
  )

  itWithSdk.live("reruns activation for SDK plugins registered during startup", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const firstStarted = yield* Deferred.make<void>()
          const releaseFirst = yield* Deferred.make<void>()
          const secondStarted = yield* Deferred.make<void>()
          const releaseSecond = yield* Deferred.make<void>()
          const sdk = yield* SdkPlugins.Service
          yield* sdk.register(
            EffectPlugin.define({
              id: "fixed-target-first-plugin",
              effect: () =>
                Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
            }),
          )

          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))
          yield* Deferred.await(firstStarted)

          const flushFiber = yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(
            Effect.provide(context),
            Effect.forkChild({ startImmediately: true }),
          )
          yield* Effect.yieldNow
          yield* sdk.register(
            EffectPlugin.define({
              id: "fixed-target-second-plugin",
              effect: () =>
                Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseSecond))),
            }),
          )

          yield* Deferred.succeed(releaseFirst, undefined)
          yield* Deferred.await(secondStarted)
          expect(flushFiber.pollUnsafe()).toBeUndefined()

          yield* Deferred.succeed(releaseSecond, undefined)
          yield* Fiber.join(flushFiber)
        }),
      ),
    ),
  )

  itWithSdk.live("reruns activation for Config updates during startup", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const activations = { count: 0 }
          const file = path.join(dir.path, "opencode.json")
          yield* Effect.promise(() => fs.writeFile(file, "{}"))
          const firstStarted = yield* Deferred.make<void>()
          const releaseFirst = yield* Deferred.make<void>()
          const secondStarted = yield* Deferred.make<void>()
          const releaseSecond = yield* Deferred.make<void>()
          const sdk = yield* SdkPlugins.Service
          yield* sdk.register(
            EffectPlugin.define({
              id: "blocked-config-reload",
              effect: () =>
                Effect.sync(() => ++activations.count).pipe(
                  Effect.flatMap((activation) =>
                    activation === 1
                      ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst)))
                      : Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseSecond))),
                  ),
                ),
            }),
          )

          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))
          yield* Deferred.await(firstStarted)

          const bus = yield* Bus.Service
          const updated = yield* bus.subscribe(Config.Event.Updated).pipe(
            Stream.filter((event) => event.location?.directory === dir.path),
            Stream.runHead,
            Effect.forkChild({ startImmediately: true }),
          )
          yield* Effect.promise(() =>
            fs.writeFile(
              file,
              JSON.stringify({ plugins: [path.join(import.meta.dir, "plugin/fixtures/config-effect-plugin.ts")] }),
            ),
          )
          yield* Fiber.join(updated)

          const flushFiber = yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(
            Effect.provide(context),
            Effect.forkChild,
          )
          yield* Deferred.succeed(releaseFirst, undefined)
          yield* Deferred.await(secondStarted)
          expect(flushFiber.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(releaseSecond, undefined)
          yield* Fiber.join(flushFiber)
          expect(activations.count).toBe(2)
        }),
      ),
    ),
  )

  itWithSdk.live("keeps flush pending while startup updates continue", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))
          const flushFiber = yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(
            Effect.provide(context),
            Effect.forkChild({ startImmediately: true }),
          )
          const bus = yield* Bus.Service

          yield* Effect.forEach(
            Array.from({ length: 5 }),
            () => bus.publish(SdkPlugins.Updated, {}).pipe(Effect.andThen(Effect.sleep("50 millis"))),
            { discard: true },
          )
          expect(flushFiber.pollUnsafe()).toBeUndefined()
          yield* Fiber.join(flushFiber)
        }),
      ),
    ),
  )

  itWithSdk.live("does not reload plugins when config updates leave plugin operations unchanged", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const activations = { count: 0 }
          const sdk = yield* SdkPlugins.Service
          yield* sdk.register(
            EffectPlugin.define({
              id: "unchanged-config-plugin",
              effect: () => Effect.sync(() => ++activations.count).pipe(Effect.asVoid),
            }),
          )

          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))
          yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(Effect.provide(context))
          expect(activations.count).toBe(1)

          yield* Bus.Service.use((bus) => bus.publish(Config.Event.Updated, {})).pipe(Effect.provide(context))
          yield* Effect.sleep("200 millis")

          expect(activations.count).toBe(1)
        }),
      ),
    ),
  )

  itWithSdk.live("keeps flush open while later hot reload runs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))
          yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(Effect.provide(context))

          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const completed = yield* Deferred.make<void>()
          const sdk = yield* SdkPlugins.Service
          yield* sdk.register(
            EffectPlugin.define({
              id: "post-ready-plugin",
              effect: () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(Deferred.succeed(completed, undefined)),
                ),
            }),
          )
          yield* Deferred.await(started)

          const flushFiber = yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(
            Effect.provide(context),
            Effect.forkChild({ startImmediately: true }),
          )
          expect(flushFiber.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(flushFiber)
          yield* Deferred.await(completed)
        }),
      ),
    ),
  )

  itWithSdk.live("does not cancel activation when a flush waiter is interrupted", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const completed = yield* Deferred.make<void>()
          const sdk = yield* SdkPlugins.Service
          yield* sdk.register(
            EffectPlugin.define({
              id: "interrupted-waiter-plugin",
              effect: () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(Deferred.succeed(completed, undefined)),
                ),
            }),
          )

          const locations = yield* LocationServiceMap.Service
          const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))
          yield* Deferred.await(started)
          const flushFiber = yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(
            Effect.provide(context),
            Effect.forkChild({ startImmediately: true }),
          )
          yield* Fiber.interrupt(flushFiber)

          yield* Deferred.succeed(release, undefined)
          yield* Deferred.await(completed)
          yield* PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(
            Effect.provide(context),
            Effect.timeout("500 millis"),
          )
        }),
      ),
    ),
  )

  it.live("applies ordered plugin config operations during boot", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(path.join(dir.path, "opencode.json"), JSON.stringify({ plugins: ["-*", "opencode.agent"] })),
          )
          const plugins = yield* Effect.gen(function* () {
            const plugins = yield* Plugin.Service
            yield* (yield* PluginSupervisor.Service).flush
            return yield* plugins.list()
          }).pipe(
            Effect.scoped,
            Effect.provide(
              LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) })),
            ),
          )

          expect(plugins.map((plugin) => plugin.id)).toEqual([Plugin.ID.make("opencode.agent")])
        }),
      ),
    ),
  )

  it.live("reloads the plugin generation after config updates", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir.path, "opencode.json")
          yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ plugins: ["-*", "opencode.agent"] })))
          yield* Effect.gen(function* () {
            const registry = yield* Plugin.Service
            const supervisor = yield* PluginSupervisor.Service
            yield* supervisor.flush
            expect((yield* registry.list()).map((plugin) => String(plugin.id))).toEqual(["opencode.agent"])

            yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ plugins: ["-*", "opencode.command"] })))
            for (let attempt = 0; attempt < 100; attempt++) {
              if ((yield* registry.list()).some((plugin) => plugin.id === "opencode.command")) break
              yield* Effect.sleep("20 millis")
            }

            expect((yield* registry.list()).map((plugin) => String(plugin.id))).toEqual(["opencode.command"])

            yield* Effect.promise(() =>
              fs.writeFile(
                file,
                JSON.stringify({
                  plugins: ["-*", path.join(import.meta.dir, "plugin/fixtures/failing-plugin.ts")],
                }),
              ),
            )
            for (let attempt = 0; attempt < 100; attempt++) {
              if ((yield* registry.list()).some((plugin) => plugin.status === "failed")) break
              yield* Effect.sleep("20 millis")
            }
            expect(yield* registry.list()).toEqual([
              {
                id: Plugin.ID.make("failing-plugin"),
                source: { type: "local", path: path.join(import.meta.dir, "plugin/fixtures/failing-plugin.ts") },
                status: "failed",
                error: expect.stringContaining("plugin failed"),
                tui: false,
              },
            ])

            yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ plugins: ["-*", "opencode.agent"] })))
            for (let attempt = 0; attempt < 100; attempt++) {
              if ((yield* registry.list()).some((plugin) => plugin.id === "opencode.agent")) break
              yield* Effect.sleep("20 millis")
            }
            expect((yield* registry.list()).map((plugin) => String(plugin.id))).toEqual(["opencode.agent"])
          }).pipe(
            Effect.scoped,
            Effect.provide(
              LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) })),
            ),
          )
        }),
      ),
    ),
  )

  it.live("routes located events only to their location", () =>
    Effect.acquireRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      (dirs) => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]())).then(() => undefined)),
    ).pipe(
      Effect.flatMap(([first, second]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const bus = yield* Bus.Service
            const firstRef = Location.Ref.make({ directory: AbsolutePath.make(first.path) })
            const secondRef = Location.Ref.make({ directory: AbsolutePath.make(second.path) })
            const firstContext = yield* locations.contextEffect(firstRef)
            const secondContext = yield* locations.contextEffect(secondRef)
            const received = { first: 0, second: 0 }
            yield* bus.subscribe(Config.Event.Updated).pipe(
              Stream.runForEach(() => Effect.sync(() => received.first++)),
              Effect.provideContext(firstContext),
              Effect.forkScoped({ startImmediately: true }),
            )
            yield* bus.subscribe(Config.Event.Updated).pipe(
              Stream.runForEach(() => Effect.sync(() => received.second++)),
              Effect.provideContext(secondContext),
              Effect.forkScoped({ startImmediately: true }),
            )
            yield* Effect.sleep("10 millis")

            yield* bus.publish(Config.Event.Updated, {}, { location: firstRef })
            yield* Effect.sleep("10 millis")

            expect(received).toEqual({ first: 1, second: 0 })
          }),
        ),
      ),
    ),
  )

  it.live("reuses cached services for constructed and decoded location refs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const directory = AbsolutePath.make(dir.path)
            const constructed = Location.Ref.make({ directory })
            const decoded = Schema.decodeUnknownSync(Location.Ref)({ directory })

            expect(constructed).toEqual({ directory, workspaceID: undefined })
            expect(decoded).toEqual(constructed)
            expect(Equal.equals(constructed, decoded)).toBe(true)
            expect(Hash.hash(constructed)).toBe(Hash.hash(decoded))
            expect(yield* locations.contextEffect(constructed)).toBe(yield* locations.contextEffect(decoded))
          }),
        ),
      ),
    ),
  )

  it.live("normalizes equivalent refs to one cached location graph", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const directory = AbsolutePath.make(dir.path)
            const alternate = AbsolutePath.make(directory.replaceAll("\\", "/"))
            const absent = Location.Ref.make({ directory: alternate })
            const present = Location.Ref.make({ directory, workspaceID: undefined })
            // The two shapes are not structurally Equal: own-key sets differ.
            expect(Object.keys(absent)).toEqual(["directory"])
            expect(Object.keys(present)).toEqual(["directory", "workspaceID"])
            expect(Equal.equals(absent, present)).toBe(false)
            if (process.platform === "win32") expect(absent.directory).not.toBe(present.directory)

            const first = yield* locations.contextEffect(absent)
            expect(yield* locations.contextEffect(present)).toBe(first)
            expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([
              Location.Ref.make({ directory, workspaceID: undefined }),
            ])

            // Invalidating with the shape opposite to the one that booted must evict.
            yield* locations.invalidate(present)
            expect(Array.from(yield* RcMap.keys(locations.rcMap))).toHaveLength(0)
          }),
        ),
      ),
    ),
  )

  it.live("isolates catalog state by location", () =>
    Effect.acquireRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      (dirs) => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]())).then(() => undefined)),
    ).pipe(
      Effect.flatMap(([blocked, allowed]) =>
        Effect.gen(function* () {
          const update = (directory: string, providerID: Provider.ID) =>
            Effect.gen(function* () {
              yield* Reference.Service
              const catalog = yield* Catalog.Service
              yield* catalog.transform((editor) => editor.provider.update(providerID, () => {}))
              const registry = yield* Tool.Service
              // Tool plugins register during the forked PluginSupervisor boot; wait for
              // every expected tool rather than relying on batch ordering.
              yield* Effect.forEach(
                [
                  "edit",
                  "glob",
                  "grep",
                  "question",
                  "read",
                  "shell",
                  "skill",
                  "subagent",
                  "webfetch",
                  "websearch",
                  "write",
                ],
                (name) => waitForTool(registry, name),
              )
              return {
                providers: yield* catalog.provider.all(),
                tools: yield* toolDefinitions(registry),
              }
            }).pipe(
              Effect.scoped,
              Effect.provide(
                LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(directory) })),
              ),
            )

          const blockedID = Provider.ID.make("blocked-location")
          const allowedID = Provider.ID.make("allowed-location")
          const blockedState = yield* update(blocked.path, blockedID)
          expect(blockedState.providers.some((provider) => provider.id === blockedID)).toBe(true)
          expect(blockedState.providers.some((provider) => provider.id === allowedID)).toBe(false)
          const blockedTools = blockedState.tools.map((tool) => tool.name)
          expect(blockedTools.filter((name) => name !== "execute").sort()).toEqual([
            "edit",
            "glob",
            "grep",
            "patch",
            "question",
            "read",
            "shell",
            "skill",
            "subagent",
            "webfetch",
            "websearch",
            "write",
          ])
          const allowedState = yield* update(allowed.path, allowedID)
          expect(allowedState.providers.some((provider) => provider.id === allowedID)).toBe(true)
          expect(allowedState.providers.some((provider) => provider.id === blockedID)).toBe(false)
          const allowedTools = allowedState.tools.map((tool) => tool.name)
          expect(blockedTools.includes("execute")).toBe(allowedTools.includes("execute"))
          expect(allowedTools.filter((name) => name !== "execute").sort()).toEqual([
            "edit",
            "glob",
            "grep",
            "patch",
            "question",
            "read",
            "shell",
            "skill",
            "subagent",
            "webfetch",
            "websearch",
            "write",
          ])
        }),
      ),
    ),
  )

  it.live("rejects an unavailable selected model during location model resolution", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(dir.path, "opencode.json"),
              JSON.stringify({
                providers: {
                  unavailable: {
                    name: "Unavailable",
                    package: "test-provider",
                    models: { chat: { disabled: true } },
                  },
                },
              }),
            ),
          )
          const failure = yield* SessionRunnerModel.Service.use((models) =>
            models.resolve(
              Session.Info.make({
                id: Session.ID.make("ses_unavailable_model"),
                projectID: Project.ID.global,
                title: "test",
                model: {
                  id: Model.ID.make("chat"),
                  providerID: Provider.ID.make("unavailable"),
                },
                cost: Money.USD.zero,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                location,
              }),
            ),
          ).pipe(Effect.provide(LocationServiceMap.Service.get(location)), Effect.flip)

          expect(failure).toMatchObject({
            _tag: "SessionRunnerModel.ModelUnavailableError",
            providerID: "unavailable",
            modelID: "chat",
          })
        }),
      ),
    ),
  )

  it.live("explains replacements for unavailable legacy provider models", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          for (const [providerID, replacement] of [
            ["azure-cognitive-services", "azure"],
            ["google-vertex-anthropic", "google-vertex"],
          ] as const) {
            const failure = yield* SessionRunnerModel.Service.use((models) =>
              models.resolve(
                Session.Info.make({
                  id: Session.ID.make(`ses_removed_${providerID}`),
                  projectID: Project.ID.global,
                  title: "test",
                  model: {
                    id: Model.ID.make("chat"),
                    providerID: Provider.ID.make(providerID),
                  },
                  cost: Money.USD.zero,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                  location,
                }),
              ),
            ).pipe(Effect.provide(LocationServiceMap.Service.get(location)), Effect.flip)

            expect(failure).toMatchObject({
              _tag: "SessionRunnerModel.ModelUnavailableError",
              providerID,
              modelID: "chat",
            })
            expect(failure.message).toBe(
              `Model unavailable: ${providerID}/chat. This provider has been deprecated; use ${replacement}/chat instead.`,
            )
          }
        }),
      ),
    ),
  )

  it.live("preserves the selected catalog identity when the package model id differs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const resolved = yield* Effect.gen(function* () {
            const catalog = yield* Catalog.Service
            yield* catalog.transform((editor) => {
              editor.provider.update(Provider.ID.make("aliased"), (provider) => {
                provider.package = Provider.aisdk("@ai-sdk/openai")
              })
              editor.model.update(Provider.ID.make("aliased"), Model.ID.make("fast"), (model) => {
                // Catalog id and package model id intentionally differ, like gpt-5.5-fast -> gpt-5.5.
                model.modelID = Model.ID.make("base")
                model.variants = [{ id: Model.VariantID.make("high") }]
              })
            })
            const models = yield* SessionRunnerModel.Service
            return yield* models.resolve(
              Session.Info.make({
                id: Session.ID.make("ses_aliased_model"),
                projectID: Project.ID.global,
                title: "test",
                model: {
                  id: Model.ID.make("fast"),
                  providerID: Provider.ID.make("aliased"),
                  variant: Model.VariantID.make("high"),
                },
                cost: Money.USD.zero,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                location,
              }),
            )
          }).pipe(Effect.provide(LocationServiceMap.Service.get(location)))

          expect(resolved.ref).toEqual(
            Model.Ref.make({
              id: Model.ID.make("fast"),
              providerID: Provider.ID.make("aliased"),
              variant: Model.VariantID.make("high"),
            }),
          )
          expect(String(resolved.model.id)).toBe("base")
        }),
      ),
    ),
  )

  it.live("installs public plugins into a location", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const reviewer = EffectPlugin.define({
            id: "reviewer",
            effect: (ctx) =>
              ctx.agent
                .transform((agent) => {
                  agent.update("reviewer", (item) => {
                    item.description = "Reviews code"
                    item.mode = "subagent"
                  })
                })
                .pipe(Effect.asVoid),
          })
          yield* plugins.activate([{ ...reviewer, version: "1" }])

          expect(yield* (yield* Agent.Service).get(Agent.ID.make("reviewer"))).toMatchObject({
            description: "Reviews code",
            mode: "subagent",
          })
        }).pipe(
          Effect.scoped,
          Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))),
        ),
      ),
    ),
  )

  itWithSdk.live("lets public plugins mutate configured and runtime MCP servers", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const url = "https://example.com/mcp"
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(dir.path, "opencode.json"),
              JSON.stringify({ mcp: { servers: { example: { type: "remote", url, disabled: true } } } }),
            ),
          )
          const observed: Record<string, boolean | undefined> = {}
          const sdk = yield* SdkPlugins.Service
          yield* sdk.register(
            EffectPlugin.define({
              id: "mcp-codemode-policy",
              effect: (ctx) =>
                ctx.mcp
                  .transform((mcp) => {
                    for (const [name, server] of mcp.list()) {
                      if (server.type !== "remote" || new URL(server.url).hostname !== "example.com") continue
                      mcp.update(name, (current) => {
                        current.codemode = false
                        observed[name] = current.codemode
                      })
                    }
                  })
                  .pipe(Effect.asVoid),
            }),
          )

          yield* Effect.gen(function* () {
            const supervisor = yield* PluginSupervisor.Service
            const mcp = yield* MCP.Service
            yield* supervisor.flush
            expect(observed.example).toBe(false)
            yield* mcp.add("dynamic", {
              type: "remote",
              url: "https://example.com/dynamic",
              disabled: true,
            })
            expect(observed.dynamic).toBe(false)
            expect((yield* mcp.servers()).map((server) => String(server.name))).toEqual(["dynamic", "example"])
          }).pipe(
            Effect.scoped,
            Effect.provide(
              LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(dir.path) })),
            ),
          )
        }),
      ),
    ),
  )
})
