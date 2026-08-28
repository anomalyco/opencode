import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect } from "bun:test"
import { Plugin as EffectPlugin } from "@opencode-ai/plugin/effect"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { ConfigPluginSource } from "@opencode-ai/core/config/plugin/source"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
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
import { tmpdir } from "../fixture/tmpdir"
import { tempGlobalLayer } from "../fixture/global"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    [Global.node, tempGlobalLayer],
  ]),
)
const staticIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    [ConfigPluginSource.node, ConfigPluginSource.empty],
    [Global.node, tempGlobalLayer],
  ]),
)

describe("PluginSupervisor config", () => {
  it.live("applies selectors in order", () =>
    withLocation(
      { plugins: ["-opencode.provider.*", "opencode.provider.openai"] },
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* ready()
        expect(
          (yield* plugins.list())
            .flatMap((plugin) => (plugin.id ? [plugin.id] : []))
            .filter((id) => id.startsWith("opencode.provider.")),
        ).toEqual([Plugin.ID.make("opencode.provider.openai")])
      }),
    ),
  )

  it.live("allows the built-in Plan agent to be disabled", () =>
    withLocation(
      { agents: { plan: { disabled: true } } },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        expect(yield* agents.get(Agent.ID.make("plan"))).toBeUndefined()
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
        const plugins = yield* Plugin.Service
        expect(yield* agents.get(Agent.ID.make("configured"))).toMatchObject({
          description: "Loaded from config",
          mode: "subagent",
        })
        expect((yield* plugins.list()).find((plugin) => plugin.id === "config-promise-plugin")).toEqual({
          id: Plugin.ID.make("config-promise-plugin"),
          source: {
            type: "local",
            path: path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts"),
          },
          status: "active",
          tui: true,
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
        const plugins = yield* Plugin.Service
        expect(yield* agents.get(Agent.ID.make("configured"))).toMatchObject({
          description: "Loaded after invalid plugins",
        })
        expect(output).toEqual([
          path.join(import.meta.dir, "../plugin/fixtures/missing-plugin.ts"),
          path.join(import.meta.dir, "../plugin/fixtures/invalid-plugin.ts"),
        ])
        expect(
          (yield* plugins.list()).filter((plugin) => plugin.status === "failed").map((plugin) => plugin.source),
        ).toEqual([
          { type: "local", path: path.join(import.meta.dir, "../plugin/fixtures/missing-plugin.ts") },
          { type: "local", path: path.join(import.meta.dir, "../plugin/fixtures/invalid-plugin.ts") },
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

  it.live("loads auto-discovered plugin package entrypoints in order", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const plugins = yield* Plugin.Service
        const ids = (yield* plugins.list()).map((plugin) => String(plugin.id))
        expect(ids).toContain("package-exports")
        expect(ids).toContain("package-module")
        expect(ids).toContain("package-main")
        expect(ids).toContain("package-index")
      }),
      false,
      async (directory) => {
        await Promise.all([
          writeDiscoveredPackage(directory, "exports", { exports: "./entry.ts" }, { "entry.ts": "package-exports" }),
          writeDiscoveredPackage(
            directory,
            "module",
            { exports: "./missing.js", module: "./entry.js" },
            { "entry.js": "package-module" },
          ),
          writeDiscoveredPackage(
            directory,
            "main",
            { exports: { import: "./missing.js" }, module: "./missing.js", main: "./entry.js" },
            { "entry.js": "package-main" },
          ),
          writeDiscoveredPackage(directory, "index", undefined, { "index.js": "package-index" }),
        ])
      },
    ),
  )

  it.live("keeps auto-discovered package entrypoints inside the package directory", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const plugins = yield* Plugin.Service
        const ids = (yield* plugins.list()).map((plugin) => String(plugin.id))
        expect(ids).toContain("contained-fallback")
        expect(ids).toContain("symlink-fallback")
        expect(ids).not.toContain("escaped-entrypoint")
      }),
      false,
      async (directory) => {
        await fs.mkdir(path.join(directory, ".opencode"), { recursive: true })
        await fs.writeFile(path.join(directory, ".opencode", "escape.js"), discoveredPlugin("escaped-entrypoint"))
        await writeDiscoveredPackage(
          directory,
          "contained",
          { exports: "../../escape.js" },
          { "index.js": "contained-fallback" },
        )
        await writeDiscoveredPackage(
          directory,
          "symlink",
          { exports: "./entry.js" },
          { "index.js": "symlink-fallback" },
        )
        await fs.symlink(
          path.join(directory, ".opencode", "escape.js"),
          path.join(directory, ".opencode", "plugins", "symlink", "entry.js"),
        )
      },
    ),
  )

  staticIt.live("uses only internal and SDK plugins when the static source is wired", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(EffectPlugin.define({ id: "static-sdk", effect: () => Effect.void }))
      yield* withLocation(
        { plugins: ["-*", path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts")] },
        Effect.gen(function* () {
          yield* ready()
          const plugins = yield* Plugin.Service
          const inventory = yield* plugins.list()
          const ids = inventory.map((plugin) => String(plugin.id))
          expect(ids).toContain("opencode.agent")
          expect(ids).toContain("static-sdk")
          expect(ids).not.toContain("config-promise-plugin")
          expect(inventory.find((plugin) => plugin.id === "static-sdk")?.source).toEqual({ type: "sdk" })

          const agents = yield* Agent.Service
          expect(yield* agents.get(Agent.ID.make("directory"))).toBeUndefined()
          expect(yield* agents.get(Agent.ID.make("configured"))).toBeUndefined()
        }),
        true,
      )
    }),
  )

  it.live("reloads an auto-discovered plugin when its file changes", () =>
    withLocation(
      undefined,
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const location = yield* Location.Service
        const plugins = yield* Plugin.Service
        const file = path.join(location.directory, ".opencode", "plugin", "mutable.ts")
        const first = (yield* plugins.list()).find((plugin) => plugin.id === "mutable-plugin")?.id

        expect(first).toBeDefined()
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("first")

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.promise(async () => {
          await fs.writeFile(file, mutablePlugin("second"))
          const modified = new Date(Date.now() + 5_000)
          await fs.utimes(file, modified, modified)
        })
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))

        const current = (yield* plugins.list()).find((plugin) => plugin.id === "mutable-plugin")?.id
        expect(current).toBe(first)
        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("second")
      }),
      false,
      async (directory) => {
        const plugin = path.join(directory, ".opencode", "plugin")
        await fs.mkdir(plugin, { recursive: true })
        await fs.writeFile(path.join(plugin, "mutable.ts"), mutablePlugin("first"))
      },
    ),
  )

  it.live("reloads a configured plugin when its source file changes", () =>
    withLocation(
      { plugins: ["-*", "./external/mutable.ts"] },
      Effect.gen(function* () {
        yield* ready()
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const location = yield* Location.Service
        const file = path.join(location.directory, "external", "mutable.ts")

        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("first")

        const changed = yield* bus
          .subscribe(Plugin.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.promise(async () => {
          await fs.writeFile(file, mutablePlugin("second"))
          const modified = new Date(Date.now() + 5_000)
          await fs.utimes(file, modified, modified)
        })
        yield* Fiber.join(changed).pipe(Effect.timeout("5 seconds"))

        expect((yield* agents.get(Agent.ID.make("mutable")))?.description).toBe("second")
      }),
      false,
      async (directory) => {
        // Outside any {plugin,plugins} config-source directory, so only the
        // configured-entrypoint watch can observe the edit.
        const external = path.join(directory, "external")
        await fs.mkdir(external, { recursive: true })
        await fs.writeFile(path.join(external, "mutable.ts"), mutablePlugin("first"))
      },
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

  it.live("unblocks flush when plugin activation fails", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(EffectPlugin.define({ id: "duplicate-id", effect: () => Effect.void }))
      yield* sdk.register(EffectPlugin.define({ id: "duplicate-id", effect: () => Effect.void }))
      yield* withLocation(
        undefined,
        Effect.gen(function* () {
          yield* ready().pipe(Effect.timeout("2 seconds"))
        }),
      )
    }),
  )
})

const ready = Effect.fnUntraced(function* () {
  const supervisor = yield* PluginSupervisor.Service
  yield* supervisor.flush
})

function withLocation<A, E, R>(
  config: unknown,
  effect: Effect.Effect<A, E, R>,
  fixtures = false,
  prepare?: (directory: string) => Promise<void>,
) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.tap((tmp) =>
      Effect.promise(async () => {
        await prepare?.(tmp.path)
        if (fixtures) {
          const directory = path.join(tmp.path, ".opencode")
          await fs.mkdir(directory, { recursive: true })
          await Promise.all(
            ["plugin", "plugins"].map((name) =>
              fs.symlink(path.join(import.meta.dir, "fixtures", name), path.join(directory, name), "dir"),
            ),
          )
        }
        if (config !== undefined) {
          const directory = fixtures ? path.join(tmp.path, ".opencode") : tmp.path
          await fs.mkdir(directory, { recursive: true })
          await fs.writeFile(path.join(directory, "opencode.json"), JSON.stringify(config))
        }
      }),
    ),
    Effect.flatMap((tmp) =>
      effect.pipe(
        Effect.scoped,
        Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }))),
      ),
    ),
  )
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

function discoveredPlugin(id: string) {
  return `export default { id: ${JSON.stringify(id)}, setup() {} }`
}

async function writeDiscoveredPackage(
  directory: string,
  name: string,
  manifest: Record<string, unknown> | undefined,
  files: Record<string, string>,
) {
  const plugin = path.join(directory, ".opencode", "plugins", name)
  await fs.mkdir(plugin, { recursive: true })
  await Promise.all([
    ...(manifest ? [fs.writeFile(path.join(plugin, "package.json"), JSON.stringify(manifest))] : []),
    ...Object.entries(files).map(([file, id]) => fs.writeFile(path.join(plugin, file), discoveredPlugin(id))),
  ])
}
