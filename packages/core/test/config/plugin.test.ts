import path from "path"
import { pathToFileURL } from "url"
import { describe, expect } from "bun:test"
import { Plugin as EffectPlugin } from "@opencode-ai/plugin/effect"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Plugin } from "@opencode-ai/core/plugin"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Fiber, Logger, Stream } from "effect"
import { Database } from "../../src/database/database"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, FSUtil.node, SdkPlugins.node, LocationServiceMap.node]),
  ),
)

describe("PluginSupervisor config", () => {
  it.live("applies selectors in order", () =>
    withLocation(
      { plugins: ["-opencode.provider.*", "opencode.provider.openai"] },
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* ready()
        expect(
          (yield* plugins.list()).map((plugin) => plugin.id).filter((id) => id.startsWith("opencode.provider.")),
        ).toEqual([Plugin.ID.make("opencode.provider.openai")])
      }),
    ),
  )

  it.live("loads configured Promise plugins with options", () =>
    withLocation(
      {
        plugins: [
          "-*",
          {
            package: path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts"),
            options: { description: "Loaded from config" },
          },
        ],
      },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("configured"))).toMatchObject({
          description: "Loaded from config",
          mode: "subagent",
        })
      }),
    ),
  )

  it.live("disables configured plugins by exported ID", () => {
    const plugin = path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts")
    return withLocation(
      { plugins: [plugin, "-config-promise-plugin"] },
      Effect.gen(function* () {
        yield* ready()
        const plugins = yield* Plugin.Service
        const agents = yield* Agent.Service
        expect((yield* plugins.list()).map((item) => String(item.id))).not.toContain("config-promise-plugin")
        expect(yield* agents.get(Agent.ID.make("configured"))).toBeUndefined()
      }),
    )
  })

  it.live("does not disable configured plugins by package target", () => {
    const plugin = path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts")
    return withLocation(
      { plugins: [plugin, `-${plugin}`] },
      Effect.gen(function* () {
        yield* ready()
        const plugins = yield* Plugin.Service
        expect((yield* plugins.list()).map((item) => String(item.id))).toContain("config-promise-plugin")
      }),
    )
  })

  it.live("loads configured Effect plugins with options", () =>
    withLocation(
      {
        plugins: [
          "-*",
          {
            package: path.join(import.meta.dir, "../plugin/fixtures/config-effect-plugin.ts"),
            options: { description: "Effect plugin from config" },
          },
        ],
      },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("effect-configured"))).toMatchObject({
          description: "Effect plugin from config",
          mode: "subagent",
        })
      }),
    ),
  )

  it.live("logs invalid packages and continues loading", () => {
    const output: string[] = []
    const logger = Logger.map(Logger.formatStructured, (entry) => {
      if (!Array.isArray(entry.message) || entry.message[0] !== "failed to load plugin") return
      const details = entry.message[1]
      if (typeof details !== "object" || details === null || !("target" in details)) return
      if (typeof details.target === "string") output.push(details.target)
    })
    return withLocation(
      {
        plugins: [
          "-*",
          path.join(import.meta.dir, "../plugin/fixtures/missing-plugin.ts"),
          path.join(import.meta.dir, "../plugin/fixtures/invalid-plugin.ts"),
          {
            package: path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts"),
            options: { description: "Loaded after invalid plugins" },
          },
        ],
      },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("configured"))).toMatchObject({
          description: "Loaded after invalid plugins",
        })
        expect(output).toEqual([
          path.join(import.meta.dir, "../plugin/fixtures/missing-plugin.ts"),
          path.join(import.meta.dir, "../plugin/fixtures/invalid-plugin.ts"),
        ])
      }),
    ).pipe(Effect.provide(Logger.layer([logger])))
  })

  it.live("loads auto-discovered plugin files", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("directory"))).toMatchObject({
          description: "Loaded from plugin directory",
        })
      }),
      true,
    ),
  )

  it.live("reloads an auto-discovered plugin when its file changes", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const filesystem = yield* FSUtil.Service
        const location = yield* Location.Service
        const plugins = yield* Plugin.Service
        const file = path.join(location.directory, ".opencode", "plugin", "mutable.ts")
        const first = (yield* plugins.list()).find((plugin) => plugin.id === "mutable-plugin")?.id

        expect(first).toBeDefined()
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("first")

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* filesystem.writeFileString(file, mutablePlugin("second"))
        const modified = new Date(Date.now() + 5_000)
        yield* filesystem.utimes(file, modified, modified)
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))

        const current = (yield* plugins.list()).find((plugin) => plugin.id === "mutable-plugin")?.id
        expect(current).toBe(first)
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("second")
      }),
      false,
      (directory, filesystem) =>
        Effect.gen(function* () {
          const plugin = path.join(directory, ".opencode", "plugin")
          yield* filesystem.makeDirectory(plugin, { recursive: true })
          yield* filesystem.writeFileString(path.join(plugin, "mutable.ts"), mutablePlugin("first"))
        }),
    ),
  )

  it.live("reloads the auto-discovered plugin lifecycle", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const filesystem = yield* FSUtil.Service
        const location = yield* Location.Service
        const plugins = yield* Plugin.Service
        const directory = path.join(location.directory, ".opencode", "plugin")
        const mutable = path.join(directory, "mutable.ts")
        const renamed = path.join(directory, "renamed.ts")
        const nextUpdate = () =>
          bus
            .subscribe(Plugin.Event.Updated)
            .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))

        const created = yield* nextUpdate()
        yield* filesystem.writeFileString(mutable, mutablePlugin("created"))
        yield* Fiber.join(created).pipe(Effect.timeout("5 seconds"))
        expect((yield* plugins.list()).some((plugin) => plugin.id === "mutable-plugin")).toBe(true)
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("created")

        const moved = yield* nextUpdate()
        yield* filesystem.rename(mutable, renamed)
        yield* Fiber.join(moved).pipe(Effect.timeout("5 seconds"))
        expect((yield* plugins.list()).some((plugin) => plugin.id === "mutable-plugin")).toBe(true)
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("created")

        const deleted = yield* nextUpdate()
        yield* filesystem.remove(renamed)
        yield* Fiber.join(deleted).pipe(Effect.timeout("5 seconds"))
        expect((yield* plugins.list()).some((plugin) => plugin.id === "mutable-plugin")).toBe(false)
        expect(yield* agents.get(Agent.ID.make("mutable"))).toBeUndefined()
      }),
      false,
      (directory, filesystem) =>
        filesystem.makeDirectory(path.join(directory, ".opencode", "plugin"), { recursive: true }),
    ),
  )

  it.live("reloads a configured file plugin outside config roots", () =>
    withLocation(
      (directory: string) => ({
        plugins: [pathToFileURL(path.join(directory, "external", "mutable.ts")).href],
      }),
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const filesystem = yield* FSUtil.Service
        const location = yield* Location.Service
        const plugins = yield* Plugin.Service
        const file = path.join(location.directory, "external", "mutable.ts")
        const first = (yield* plugins.list()).find((plugin) => plugin.id === "mutable-plugin")?.id

        expect(first).toBeDefined()
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("first")

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* filesystem.writeFileString(file, mutablePlugin("second"))
        const modified = new Date(Date.now() + 5_000)
        yield* filesystem.utimes(file, modified, modified)
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))

        const current = (yield* plugins.list()).find((plugin) => plugin.id === "mutable-plugin")?.id
        expect(current).toBe(first)
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("second")
      }),
      false,
      (directory, filesystem) =>
        Effect.gen(function* () {
          const external = path.join(directory, "external")
          yield* filesystem.makeDirectory(external, { recursive: true })
          yield* filesystem.writeFileString(path.join(external, "mutable.ts"), mutablePlugin("first"))
        }),
    ),
  )

  it.live("moves the configured file watcher when config changes", () =>
    withLocation(
      (directory) => ({
        plugins: [pathToFileURL(path.join(directory, "external", "first.ts")).href],
      }),
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const filesystem = yield* FSUtil.Service
        const location = yield* Location.Service
        const config = path.join(location.directory, "opencode.json")
        const first = path.join(location.directory, "external", "first.ts")
        const second = path.join(location.directory, "external", "second.ts")
        let updates = 0
        yield* bus.subscribe(Plugin.Event.Updated).pipe(
          Stream.runForEach(() => Effect.sync(() => updates++)),
          Effect.forkScoped({ startImmediately: true }),
        )

        const moved = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* filesystem.writeFileString(config, JSON.stringify({ plugins: [pathToFileURL(second).href] }))
        yield* Fiber.join(moved).pipe(Effect.timeout("5 seconds"))
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("second")
        yield* Effect.sleep("100 millis")

        yield* filesystem.writeFileString(first, mutablePlugin("stale"))
        const staleMtime = new Date(Date.now() + 5_000)
        yield* filesystem.utimes(first, staleMtime, staleMtime)
        yield* Effect.sleep("300 millis")
        expect(updates).toBe(1)

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* filesystem.writeFileString(second, mutablePlugin("updated"))
        const updatedMtime = new Date(Date.now() + 5_000)
        yield* filesystem.utimes(second, updatedMtime, updatedMtime)
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))
        expect(updates).toBe(2)
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("updated")
      }),
      false,
      (directory, filesystem) =>
        Effect.gen(function* () {
          const external = path.join(directory, "external")
          yield* filesystem.makeDirectory(external, { recursive: true })
          yield* filesystem.writeFileString(path.join(external, "first.ts"), mutablePlugin("first"))
          yield* filesystem.writeFileString(path.join(external, "second.ts"), mutablePlugin("second"))
        }),
    ),
  )

  it.live("ignores changes outside plugin source directories", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const bus = yield* Bus.Service
        const filesystem = yield* FSUtil.Service
        const location = yield* Location.Service
        let updates = 0
        yield* bus.subscribe(Plugin.Event.Updated).pipe(
          Stream.runForEach(() => Effect.sync(() => updates++)),
          Effect.forkScoped({ startImmediately: true }),
        )

        const notes = path.join(location.directory, ".opencode", "notes")
        yield* filesystem.makeDirectory(notes, { recursive: true })
        yield* filesystem.writeFileString(path.join(notes, "todo.md"), "unrelated")
        yield* Effect.sleep("300 millis")
        expect(updates).toBe(0)

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        const plugins = path.join(location.directory, ".opencode", "plugin")
        yield* filesystem.makeDirectory(plugins, { recursive: true })
        yield* filesystem.writeFileString(path.join(plugins, "mutable.ts"), mutablePlugin("related"))
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))
        expect(updates).toBe(1)
      }),
      false,
      (directory, filesystem) => filesystem.makeDirectory(path.join(directory, ".opencode"), { recursive: true }),
    ),
  )

  it.live("applies explicit removals after auto-discovery", () =>
    withLocation(
      { plugins: ["-*"] },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("directory"))).toBeUndefined()
      }),
      true,
    ),
  )

  it.live("loads user plugins before internal post plugins", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(EffectPlugin.define({ id: "sdk-order", effect: () => Effect.void }))
      yield* withLocation(
        {
          plugins: [
            path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts"),
            path.join(import.meta.dir, "../plugin/fixtures/variant-source-plugin.ts"),
          ],
        },
        Effect.gen(function* () {
          yield* ready()
          const registry = yield* Plugin.Service
          const ids = (yield* registry.list()).map((plugin) => String(plugin.id))
          expect(ids.indexOf("opencode.agent")).toBeLessThan(ids.indexOf("sdk-order"))
          expect(ids.indexOf("sdk-order")).toBeLessThan(ids.indexOf("config-promise-plugin"))
          expect(ids.indexOf("config-promise-plugin")).toBeLessThan(ids.indexOf("variant-source"))
          expect(ids.indexOf("variant-source")).toBeLessThan(ids.indexOf("opencode.config.provider"))
          expect(ids.indexOf("opencode.config.provider")).toBeLessThan(ids.indexOf("opencode.variant"))

          const catalog = yield* Catalog.Service
          expect(
            (yield* catalog.model.get(Provider.ID.make("configured"), Model.ID.make("glm-5.2")))?.variants,
          ).toEqual([
            expect.objectContaining({ id: "high", headers: { custom: "true" } }),
            expect.objectContaining({ id: "max", settings: { reasoningEffort: "max" } }),
          ])
        }),
      )
    }),
  )

  it.live("allows variant generation to be disabled", () =>
    withLocation(
      {
        plugins: [path.join(import.meta.dir, "../plugin/fixtures/variant-source-plugin.ts"), "-opencode.variant"],
      },
      Effect.gen(function* () {
        yield* ready()
        const registry = yield* Plugin.Service
        expect((yield* registry.list()).map((plugin) => String(plugin.id))).not.toContain("opencode.variant")

        const catalog = yield* Catalog.Service
        expect((yield* catalog.model.get(Provider.ID.make("configured"), Model.ID.make("glm-5.2")))?.variants).toEqual([
          expect.objectContaining({ id: "high", headers: { custom: "true" } }),
        ])
      }),
    ),
  )
})

const ready = Effect.fnUntraced(function* () {
  const supervisor = yield* PluginSupervisor.Service
  yield* supervisor.flush
})

type LocationConfig = Record<string, unknown> | undefined

function withLocation<A, E, R, E2>(
  config: LocationConfig | ((directory: string) => LocationConfig),
  effect: Effect.Effect<A, E, R>,
  fixtures = false,
  prepare?: (directory: string, fs: FSUtil.Interface) => Effect.Effect<void, E2>,
) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-core-test-" })
    const directory = yield* fs.realPath(temporary)
    if (prepare) yield* prepare(directory, fs)
    if (fixtures) {
      const configDirectory = path.join(directory, ".opencode")
      yield* fs.makeDirectory(configDirectory, { recursive: true })
      yield* Effect.forEach(
        ["plugin", "plugins"],
        (name) => fs.symlink(path.join(import.meta.dir, "fixtures", name), path.join(configDirectory, name)),
        { discard: true },
      )
    }
    const value = typeof config === "function" ? config(directory) : config
    if (value !== undefined) {
      const configDirectory = fixtures ? path.join(directory, ".opencode") : directory
      yield* fs.makeDirectory(configDirectory, { recursive: true })
      yield* fs.writeFileString(path.join(configDirectory, "opencode.json"), JSON.stringify(value))
    }
    return yield* effect.pipe(
      Effect.scoped,
      Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    )
  })
}

function mutablePlugin(description: string) {
  const plugin = pathToFileURL(path.join(import.meta.dir, "../../../plugin/src/promise/index.ts")).href
  return `
import { Plugin } from ${JSON.stringify(plugin)}

export default Plugin.define({
  id: "mutable-plugin",
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update("mutable", (agent) => {
        agent.description = ${JSON.stringify(description)}
        agent.mode = "subagent"
      })
    })
  },
})
`
}
