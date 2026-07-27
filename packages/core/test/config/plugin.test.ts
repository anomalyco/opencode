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
import { tempDirectory } from "../lib/filesystem"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, FSUtil.node, SdkPlugins.node, LocationServiceMap.node]),
  ),
)

describe.serial("PluginSupervisor config", () => {
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

  for (const testCase of pluginLifecycleCases()) {
    it.live(`reloads an auto-discovered plugin when ${testCase.name}`, () =>
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
          const changed = yield* bus
            .subscribe(Plugin.Event.Updated)
            .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
          yield* testCase.mutate(filesystem, directory)
          yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))
          yield* testCase.verify(agents, plugins)
        }),
        false,
        (directory, filesystem) =>
          Effect.gen(function* () {
            const plugins = path.join(directory, ".opencode", "plugin")
            yield* filesystem.makeDirectory(plugins, { recursive: true })
            yield* testCase.prepare(filesystem, plugins)
          }),
      ),
    )
  }

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

  it.live("installs the configured file watcher before publishing the config generation", () =>
    withLocation(
      (directory) => ({
        plugins: [{ package: "./.opencode/custom/first.ts" }],
      }),
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const filesystem = yield* FSUtil.Service
        const location = yield* Location.Service
        const config = path.join(location.directory, "opencode.json")
        const second = path.join(location.directory, "external", "second.ts")
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("first")
        const moved = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* filesystem.writeFileString(config, JSON.stringify({ plugins: [second] }))
        yield* Fiber.join(moved).pipe(Effect.timeout("5 seconds"))
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("second")

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* filesystem.writeFileString(second, mutablePlugin("updated"))
        const updatedMtime = new Date(Date.now() + 5_000)
        yield* filesystem.utimes(second, updatedMtime, updatedMtime)
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("updated")
      }),
      false,
      (directory, filesystem) =>
        Effect.gen(function* () {
          const external = path.join(directory, "external")
          const custom = path.join(directory, ".opencode", "custom")
          yield* filesystem.makeDirectory(external, { recursive: true })
          yield* filesystem.makeDirectory(custom, { recursive: true })
          yield* filesystem.writeFileString(path.join(custom, "first.ts"), mutablePlugin("first"))
          yield* filesystem.writeFileString(path.join(external, "second.ts"), mutablePlugin("second"))
        }),
    ),
  )

  it.live("keeps reloading after configured watcher failures", () =>
    withLocation(
      (directory) => ({
        plugins: ["file://%", path.join(directory, "missing", "plugin.ts")],
      }),
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const filesystem = yield* FSUtil.Service
        const location = yield* Location.Service
        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        const plugins = path.join(location.directory, ".opencode", "plugin")
        yield* filesystem.makeDirectory(plugins, { recursive: true })
        yield* filesystem.writeFileString(path.join(plugins, "mutable.ts"), mutablePlugin("recovered"))
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("recovered")
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
    const temporary = yield* tempDirectory
    const fs = temporary.fs
    const directory = temporary.path
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

function pluginLifecycleCases() {
  return [
    {
      name: "created",
      prepare: () => Effect.void,
      mutate: (fs: FSUtil.Interface, directory: string) =>
        fs.writeFileString(path.join(directory, "mutable.ts"), mutablePlugin("created")),
      verify: (agents: Agent.Interface, plugins: Plugin.Interface) =>
        Effect.gen(function* () {
          expect((yield* plugins.list()).some((plugin) => plugin.id === "mutable-plugin")).toBe(true)
          expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("created")
        }),
    },
    {
      name: "renamed",
      prepare: (fs: FSUtil.Interface, directory: string) =>
        fs.writeFileString(path.join(directory, "mutable.ts"), mutablePlugin("renamed")),
      mutate: (fs: FSUtil.Interface, directory: string) =>
        fs.rename(path.join(directory, "mutable.ts"), path.join(directory, "renamed.ts")),
      verify: (agents: Agent.Interface, plugins: Plugin.Interface) =>
        Effect.gen(function* () {
          expect((yield* plugins.list()).some((plugin) => plugin.id === "mutable-plugin")).toBe(true)
          expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("renamed")
        }),
    },
    {
      name: "deleted",
      prepare: (fs: FSUtil.Interface, directory: string) =>
        fs.writeFileString(path.join(directory, "mutable.ts"), mutablePlugin("deleted")),
      mutate: (fs: FSUtil.Interface, directory: string) => fs.remove(path.join(directory, "mutable.ts")),
      verify: (agents: Agent.Interface, plugins: Plugin.Interface) =>
        Effect.gen(function* () {
          expect((yield* plugins.list()).some((plugin) => plugin.id === "mutable-plugin")).toBe(false)
          expect(yield* agents.get(Agent.ID.make("mutable"))).toBeUndefined()
        }),
    },
  ] as const
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
