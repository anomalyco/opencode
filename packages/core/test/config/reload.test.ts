import path from "path"
import fs from "fs/promises"
import { writeFileSync } from "node:fs"
import { describe, expect } from "bun:test"
import { Document, Event, Info } from "@opencode-ai/schema/config"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Command } from "@opencode-ai/core/command"
import { Config } from "@opencode-ai/core/config"
import { ConfigAgentPlugin } from "@opencode-ai/core/config/plugin/agent"
import { ConfigCommandPlugin } from "@opencode-ai/core/config/plugin/command"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { ConfigReferencePlugin } from "@opencode-ai/core/config/plugin/reference"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { Bus } from "@opencode-ai/core/bus"
import { Integration } from "@opencode-ai/core/integration"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Provider } from "@opencode-ai/core/provider"
import { Reference } from "@opencode-ai/core/reference"
import { Skill } from "@opencode-ai/core/skill"
import { ShellSelect } from "@opencode-ai/core/shell/select"
import { Global } from "@opencode-ai/util/global"
import { Location } from "@opencode-ai/core/location"
import { Credential } from "@opencode-ai/core/credential"
import { WellKnown } from "@opencode-ai/core/wellknown"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { AppProcess } from "@opencode-ai/util/process"
import { Deferred, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"

const it = testEffect(
  Layer.merge(PluginTestLayer, AppNodeBuilder.build(LayerNode.group([AppProcess.node, ShellSelect.node]))),
)
const decode = Schema.decodeUnknownSync(Info)
const document = path.join(import.meta.dir, "opencode.json")

describe("config plugin reloads", () => {
  it.live("retains readiness signalled synchronously during initial config startup", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) => {
        const native = Watcher.Native.of({
          subscribe: (input) =>
            Effect.sync(() => {
              if (input.type === "entries" && input.target === tmp.path) {
                // No event is emitted: only synchronous readiness can trigger the reload.
                writeFileSync(path.join(tmp.path, "opencode.json"), JSON.stringify({ references: { docs: "./docs" } }))
              }
              return { unsubscribe: () => Promise.resolve() }
            }),
        })
        return Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const references = yield* Reference.Service
          const host = yield* PluginHost.make(plugins)
          yield* ConfigReferencePlugin.Plugin.effect(host)
          yield* waitUntil(references.list().pipe(Effect.map((items) => items.some((item) => item.name === "docs"))))
          expect((yield* references.list())[0]?.path).toBe(AbsolutePath.make(path.join(tmp.path, "docs")))
        }).pipe(Effect.provide(liveConfig(tmp.path, native)))
      }),
    ),
  )

  it.live("loads the first config written while a new directory watch is starting", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = path.join(tmp.path, ".opencode")
          const parent = yield* Deferred.make<(update: Watcher.Update) => void>()
          const starting = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const native = Watcher.Native.of({
            subscribe: (input) =>
              Effect.gen(function* () {
                if (input.type === "entries" && input.target === tmp.path) {
                  yield* Deferred.succeed(parent, input.publish)
                }
                if (input.type === "directory" && input.target === root) {
                  yield* Deferred.succeed(starting, undefined)
                  yield* Deferred.await(release)
                }
                return { unsubscribe: () => Promise.resolve() }
              }),
          })
          return yield* Effect.gen(function* () {
            const plugins = yield* Plugin.Service
            const references = yield* Reference.Service
            const host = yield* PluginHost.make(plugins)
            yield* ConfigReferencePlugin.Plugin.effect(host)
            const publish = yield* Deferred.await(parent)
            yield* Effect.promise(() => fs.mkdir(root))
            publish({ path: root, type: "create" })
            yield* Deferred.await(starting).pipe(Effect.timeout("2 seconds"))
            // No file event: the recursive native watch has not been acquired yet.
            yield* Effect.promise(() =>
              fs.writeFile(path.join(root, "opencode.json"), JSON.stringify({ references: { docs: "./docs" } })),
            )
            yield* Deferred.succeed(release, undefined)
            yield* waitUntil(references.list().pipe(Effect.map((items) => items.some((item) => item.name === "docs"))))
            expect((yield* references.list())[0]?.path).toBe(AbsolutePath.make(path.join(root, "docs")))
          }).pipe(Effect.provide(liveConfig(tmp.path, native)))
        }),
      ),
    ),
  )

  for (const input of [
    { file: "opencode.json", empty: false },
    { file: "../opencode.jsonc", empty: false },
    { file: ".opencode/opencode.json", empty: false },
    { file: "../.opencode/opencode.jsonc", empty: true },
  ]) {
    it.live(`loads references when ${input.file} is first created and keeps watching it`, () =>
      Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const project = path.join(tmp.path, "project")
            const target = path.resolve(project, input.file)
            yield* Effect.promise(() => fs.mkdir(project))
            return yield* Effect.gen(function* () {
              const plugins = yield* Plugin.Service
              const references = yield* Reference.Service
              const host = yield* PluginHost.make(plugins)
              yield* ConfigReferencePlugin.Plugin.effect(host)
              expect(yield* references.list()).toEqual([])

              if (input.empty) {
                yield* Effect.promise(() => fs.mkdir(path.dirname(target)))
                const config = yield* Config.Service
                yield* waitUntil(
                  config
                    .entries()
                    .pipe(
                      Effect.map((entries) =>
                        entries.some((entry) => entry.type === "directory" && entry.path === path.dirname(target)),
                      ),
                    ),
                )
              }
              yield* Effect.promise(async () => {
                await fs.mkdir(path.dirname(target), { recursive: true })
                await fs.writeFile(target, JSON.stringify({ references: { docs: "./docs" } }))
              })
              yield* waitUntil(
                references.list().pipe(Effect.map((items) => items.some((item) => item.name === "docs"))),
              )
              expect((yield* references.list())[0]?.path).toBe(
                AbsolutePath.make(path.join(path.dirname(target), "docs")),
              )
              yield* Effect.promise(() => fs.writeFile(target, JSON.stringify({ references: { next: "./next" } })))
              yield* waitUntil(
                references.list().pipe(Effect.map((items) => items.length === 1 && items[0]?.name === "next")),
              )

              yield* Effect.promise(() =>
                fs.rm(input.file.includes(".opencode/") ? path.dirname(target) : target, { recursive: true }),
              )
              yield* waitUntil(references.list().pipe(Effect.map((items) => items.length === 0)))
              yield* Effect.promise(async () => {
                await fs.mkdir(path.dirname(target), { recursive: true })
                await fs.writeFile(target, JSON.stringify({ references: { docs: "./docs" } }))
              })
              yield* waitUntil(
                references.list().pipe(Effect.map((items) => items.length === 1 && items[0]?.name === "docs")),
              )
              yield* Effect.promise(() => fs.writeFile(target, JSON.stringify({ references: { next: "./next" } })))
              yield* waitUntil(
                references.list().pipe(Effect.map((items) => items.length === 1 && items[0]?.name === "next")),
              )
            }).pipe(Effect.provide(liveConfig(project)))
          }),
        ),
      ),
    )
  }

  it.effect("preserves reference precedence and insertion order across documents", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const references = yield* Reference.Service
      const host = yield* PluginHost.make(plugins)
      yield* references.transform((editor) =>
        editor.add(
          "external",
          Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("/references/external") }),
        ),
      )
      yield* ConfigReferencePlugin.Plugin.effect(host)

      const result = yield* references.list()
      expect(result.map((reference) => reference.name)).toEqual(["external", "shared", "first", "second"])
      expect(result.find((reference) => reference.name === "shared")?.path).toBe(
        AbsolutePath.make(path.resolve("/config/second/shared")),
      )
    }).pipe(
      Effect.provide(
        Config.testLayer([
          referenceConfig("/config/first/opencode.json", {
            shared: "./shared",
            first: "./first",
          }),
          referenceConfig("/config/second/opencode.json", {
            shared: "./shared",
            second: "./second",
          }),
        ]),
      ),
      Effect.provideService(Global.Service, Global.Service.of(Global.make())),
    ),
  )

  it.live("reloads config-backed domains without reloading external plugins", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const catalog = yield* Catalog.Service
      const commands = yield* Command.Service
      const integrations = yield* Integration.Service
      const bus = yield* Bus.Service
      const plugins = yield* Plugin.Service
      const references = yield* Reference.Service
      const skills = yield* Skill.Service
      const host = yield* PluginHost.make(plugins)
      const test = yield* Config.Test

      yield* ConfigAgentPlugin.Plugin.effect(host)
      yield* ConfigCommandPlugin.Plugin.effect(host)
      yield* ConfigSkillPlugin.Plugin.effect(host)
      yield* ConfigReferencePlugin.Plugin.effect(host)
      yield* ConfigProviderPlugin.Plugin.effect(host)

      expect((yield* agents.get(Agent.ID.make("first")))?.description).toBe("First agent")
      expect((yield* commands.get("first"))?.description).toBe("First command")
      expect(yield* integrations.get(Integration.ID.make("first"))).toBeDefined()
      expect((yield* skills.list()).some((skill) => skill.id === "first")).toBe(true)
      expect((yield* references.list()).map((reference) => reference.name)).toEqual(["first"])
      expect(yield* catalog.provider.get(Provider.ID.make("first"))).toBeDefined()

      yield* test.setEntries([config("second")])
      yield* Effect.yieldNow
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        Effect.gen(function* () {
          return (
            (yield* agents.get(Agent.ID.make("first"))) === undefined &&
            (yield* agents.get(Agent.ID.make("second")))?.description === "Second agent" &&
            (yield* commands.get("first")) === undefined &&
            (yield* commands.get("second"))?.description === "Second command" &&
            (yield* integrations.get(Integration.ID.make("first"))) === undefined &&
            (yield* integrations.get(Integration.ID.make("second"))) !== undefined &&
            (yield* references.list()).some((reference) => reference.name === "second") &&
            (yield* catalog.provider.get(Provider.ID.make("first"))) === undefined &&
            (yield* catalog.provider.get(Provider.ID.make("second"))) !== undefined
          )
        }),
      )

      expect((yield* skills.list()).some((skill) => skill.id === "first")).toBe(false)
      expect((yield* skills.list()).some((skill) => skill.id === "second")).toBe(true)
    }).pipe(
      Effect.provide(Config.testLayer([config("first")])),
      Effect.provideService(Global.Service, Global.Service.of(Global.make())),
    ),
  )
})

function liveConfig(directory: string, native?: Watcher.NativeInterface) {
  return AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node, Reference.node, Global.node, Location.node]), [
    Config.node.replace(Config.configured({ global: false })),
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
    Global.node.replace(
      Global.layerWith({ config: path.join(directory, "global"), home: path.join(directory, "home") }),
    ),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    ...(native
      ? [Watcher.node.replace(Watcher.layer().pipe(Layer.provide(Layer.succeed(Watcher.Native, native))))]
      : []),
  ])
}

function config(name: string) {
  return new Document({
    type: "document",
    path: AbsolutePath.make(document),
    info: decode({
      agents: { [name]: { description: `${title(name)} agent`, mode: "subagent" } },
      commands: { [name]: { template: `${title(name)} command`, description: `${title(name)} command` } },
      skills: [path.join(import.meta.dir, "fixture", "skills", `${name}-source`)],
      references: { [name]: `/references/${name}` },
      providers: { [name]: { models: { chat: { name: `${title(name)} model` } } } },
    }),
  })
}

function referenceConfig(file: string, references: Record<string, string>) {
  return new Document({
    type: "document",
    path: AbsolutePath.make(file),
    info: decode({ references }),
  })
}

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const waitUntil = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (yield* condition) return
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die("Timed out waiting for config plugin reloads")
})
