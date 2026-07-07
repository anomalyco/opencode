import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Config } from "@opencode-ai/schema/config"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Context, DateTime, Effect, Equal, Hash, Schema, Stream } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolDefinitions, waitForTool } from "./lib/tool"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { Reference } from "../src/reference"
import { ToolRegistry } from "../src/tool/registry"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, LocationServiceMap.node])))
const itWithSdk = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SdkPlugins.node, LocationServiceMap.node])),
)

describe("LocationServiceMap", () => {
  itWithSdk.live("preserves embedded SDK plugins after Location eviction", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sdk = yield* SdkPlugins.Service
          const locations = yield* LocationServiceMap.Service
          const id = AgentV2.ID.make("persistent-sdk-agent")
          const plugin = define({
            id: "persistent-sdk-plugin",
            effect: (ctx) => ctx.agent.transform((agents) => agents.update(id, () => {})),
          })
          yield* sdk.register(plugin)

          const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const read = Effect.gen(function* () {
            const supervisor = yield* PluginSupervisor.Service
            yield* supervisor.ready
            const agents = yield* AgentV2.Service
            return yield* agents.get(id)
          })

          expect(yield* read.pipe(Effect.scoped, Effect.provide(locations.get(ref)))).toBeDefined()
          yield* locations.invalidate(ref)
          expect(yield* read.pipe(Effect.scoped, Effect.provide(locations.get(ref)))).toBeDefined()
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
            const plugins = yield* PluginV2.Service
            yield* (yield* PluginSupervisor.Service).ready
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
            const registry = yield* PluginV2.Service
            const supervisor = yield* PluginSupervisor.Service
            yield* supervisor.ready
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
              if ((yield* registry.list()).length === 0) break
              yield* Effect.sleep("20 millis")
            }
            expect(yield* registry.list()).toEqual([])

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
            const events = yield* EventV2.Service
            const firstRef = Location.Ref.make({ directory: AbsolutePath.make(first.path) })
            const secondRef = Location.Ref.make({ directory: AbsolutePath.make(second.path) })
            const firstContext = yield* locations.contextEffect(firstRef)
            const secondContext = yield* locations.contextEffect(secondRef)
            const received = { first: 0, second: 0 }
            yield* events.subscribe(Config.Event.Updated).pipe(
              Stream.runForEach(() => Effect.sync(() => received.first++)),
              Effect.provideContext(firstContext),
              Effect.forkScoped({ startImmediately: true }),
            )
            yield* events.subscribe(Config.Event.Updated).pipe(
              Stream.runForEach(() => Effect.sync(() => received.second++)),
              Effect.provideContext(secondContext),
              Effect.forkScoped({ startImmediately: true }),
            )
            yield* Effect.sleep("10 millis")

            yield* events.publish(Config.Event.Updated, {}, { location: firstRef })
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

  it.live("isolates catalog state by location", () =>
    Effect.acquireRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      (dirs) => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]())).then(() => undefined)),
    ).pipe(
      Effect.flatMap(([blocked, allowed]) =>
        Effect.gen(function* () {
          const update = (directory: string, providerID: ProviderV2.ID) =>
            Effect.gen(function* () {
              yield* Reference.Service
              const catalog = yield* Catalog.Service
              yield* catalog.transform((editor) => editor.provider.update(providerID, () => {}))
              const registry = yield* ToolRegistry.Service
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
                  "todowrite",
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

          const blockedID = ProviderV2.ID.make("blocked-location")
          const allowedID = ProviderV2.ID.make("allowed-location")
          const blockedState = yield* update(blocked.path, blockedID)
          expect(blockedState.providers.some((provider) => provider.id === blockedID)).toBe(true)
          expect(blockedState.providers.some((provider) => provider.id === allowedID)).toBe(false)
          expect(blockedState.tools.map((tool) => tool.name).sort()).toEqual([
            "edit",
            "glob",
            "grep",
            "question",
            "read",
            "shell",
            "skill",
            "subagent",
            "todowrite",
            "webfetch",
            "websearch",
            "write",
          ])
          const allowedState = yield* update(allowed.path, allowedID)
          expect(allowedState.providers.some((provider) => provider.id === allowedID)).toBe(true)
          expect(allowedState.providers.some((provider) => provider.id === blockedID)).toBe(false)
          expect(allowedState.tools.map((tool) => tool.name).sort()).toEqual([
            "edit",
            "glob",
            "grep",
            "question",
            "read",
            "shell",
            "skill",
            "subagent",
            "todowrite",
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
              SessionV2.Info.make({
                id: SessionV2.ID.make("ses_unavailable_model"),
                projectID: ProjectV2.ID.global,
                title: "test",
                model: {
                  id: ModelV2.ID.make("chat"),
                  providerID: ProviderV2.ID.make("unavailable"),
                },
                cost: 0,
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
              editor.provider.update(ProviderV2.ID.make("aliased"), (provider) => {
                provider.package = ProviderV2.aisdk("@ai-sdk/openai")
              })
              editor.model.update(ProviderV2.ID.make("aliased"), ModelV2.ID.make("fast"), (model) => {
                // Catalog id and package model id intentionally differ, like gpt-5.5-fast -> gpt-5.5.
                model.modelID = ModelV2.ID.make("base")
                model.variants = [{ id: ModelV2.VariantID.make("high") }]
              })
            })
            const models = yield* SessionRunnerModel.Service
            return yield* models.resolve(
              SessionV2.Info.make({
                id: SessionV2.ID.make("ses_aliased_model"),
                projectID: ProjectV2.ID.global,
                title: "test",
                model: {
                  id: ModelV2.ID.make("fast"),
                  providerID: ProviderV2.ID.make("aliased"),
                  variant: ModelV2.VariantID.make("high"),
                },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
                location,
              }),
            )
          }).pipe(Effect.provide(LocationServiceMap.Service.get(location)))

          expect(resolved.ref).toEqual(
            ModelV2.Ref.make({
              id: ModelV2.ID.make("fast"),
              providerID: ProviderV2.ID.make("aliased"),
              variant: ModelV2.VariantID.make("high"),
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
          const plugins = yield* PluginV2.Service
          const reviewer = define({
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
          yield* plugins.activate([{ plugin: reviewer }])

          expect(yield* (yield* AgentV2.Service).get(AgentV2.ID.make("reviewer"))).toMatchObject({
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
})
