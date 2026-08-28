import path from "node:path"
import fs from "node:fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginModule } from "@opencode-ai/core/plugin/module"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { PackageStatus } from "@opencode-ai/schema/plugin"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Npm } from "@opencode-ai/util/npm"
import { tempGlobalLayer } from "../fixture/global"
import { tmpdir } from "../fixture/tmpdir"
import { it, testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const pluginIt = testEffect(PluginTestLayer)

// Bun.build inside bun test panics on Windows; the Node import boundary is platform-independent.
describe.skipIf(process.platform === "win32")("Node plugin revisions", () => {
  it.live("keeps the loaded revision across Node CommonJS namespace wrappers", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("plugin-node-revision-")))
      const entrypoint = path.join(tmp.path, "plugin.cjs")
      const harness = path.join(tmp.path, "harness.ts")
      yield* Effect.promise(() =>
        fs.symlink(path.join(import.meta.dir, "../../../util/node_modules"), path.join(tmp.path, "node_modules")),
      )
      yield* Effect.promise(() =>
        Bun.write(
          harness,
          `
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { PluginModule } from ${JSON.stringify(path.join(import.meta.dir, "../../src/plugin/module.ts"))}
import { Npm } from ${JSON.stringify(path.join(import.meta.dir, "../../../util/src/npm.ts"))}
const entrypoint = process.argv[2]
const source = (tui) => 'module.exports = { id: "node-revision-plugin", tui: ' + tui + ', effect: () => {} }'
const load = (revision) => Effect.runPromise(PluginModule.load({ type: "add", target: "inspection-plugin@latest", options: {} }).pipe(
  Effect.provideService(Npm.Service, {
    add: () => Effect.succeed({ directory: "", entrypoint, revision }),
    resolve: () => Effect.die("unused resolve"),
    check: () => Effect.die("unused check"),
    which: () => Effect.die("unused which"),
  }),
))
await writeFile(entrypoint, source(false))
const first = await load("1.0.0")
assert.deepEqual({ tui: first.tui, revision: first.revision }, { tui: false, revision: "1.0.0" })
await writeFile(entrypoint, source(true))
const second = await load("2.0.0")
assert.deepEqual({ tui: second.tui, revision: second.revision }, { tui: false, revision: "1.0.0" })
`,
        ),
      )
      const result = yield* Effect.promise(() =>
        Bun.build({
          entrypoints: [harness],
          outdir: tmp.path,
          naming: "[name].mjs",
          target: "node",
          conditions: ["node"],
          plugins: [
            {
              name: "externalize-dependencies",
              setup(build) {
                build.onResolve({ filter: /^[^.#/]/ }, (args) =>
                  args.path.startsWith("@opencode-ai/") ? undefined : { path: args.path, external: true },
                )
              },
            },
          ],
        }),
      )
      expect(result.success).toBe(true)
      const child = Bun.spawn(["node", path.join(tmp.path, "harness.mjs"), entrypoint], {
        cwd: tmp.path,
        env: {
          PATH: process.env.PATH,
          HOME: tmp.path,
          XDG_CONFIG_HOME: path.join(tmp.path, "config"),
          XDG_DATA_HOME: path.join(tmp.path, "data"),
          XDG_CACHE_HOME: path.join(tmp.path, "cache"),
          XDG_STATE_HOME: path.join(tmp.path, "state"),
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => child.kill()))
      expect(
        yield* Effect.promise(() =>
          Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
        ),
      ).toEqual([0, expect.any(String), expect.any(String)])
    }),
  )
})

pluginIt.live("keeps loaded revision tied to cached module code rather than refreshed disk metadata", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("plugin-revision-")))
    const entrypoint = path.join(tmp.path, "plugin.ts")
    const source = (tui: boolean) =>
      `import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))}\nexport default { id: "revision-plugin", tui: ${tui}, effect: () => Effect.void }\n`
    yield* Effect.promise(() => Bun.write(entrypoint, source(false)))
    const npm = yield* Npm.Service
    const plugins = yield* Plugin.Service
    const operation = { type: "add" as const, target: "inspection-plugin@latest", options: {} }
    const load = (revision: string, options: Record<string, unknown>) =>
      PluginModule.load({ ...operation, options }).pipe(
        Effect.provideService(Npm.Service, {
          ...npm,
          add: () => Effect.succeed({ directory: tmp.path, entrypoint, revision }),
        }),
      )
    const first = yield* load("1.0.0", {})
    yield* plugins.activate([first])
    expect(first.version).toBe(JSON.stringify(operation))
    expect(first.source).toEqual({ type: "package", package: operation.target })
    expect((yield* plugins.list())[0]?.revision).toBe("1.0.0")

    yield* Effect.promise(() => Bun.write(entrypoint, source(true)))
    const second = yield* load("2.0.0", { changed: true })
    expect(second.tui).toBe(false)
    expect(second.revision).toBe("1.0.0")
    yield* plugins.activate([second])
    expect((yield* plugins.list())[0]?.revision).toBe("1.0.0")
    yield* plugins.activate([{ ...second, version: "failed", effect: () => Effect.die("setup failed") }])
    expect((yield* plugins.list())[0]).toMatchObject({ status: "failed", revision: "1.0.0" })
    expect(Plugin.PackageStatus).toBe(PackageStatus)
  }),
)

pluginIt.effect("rejects in-process checks in Effect and Promise setup without waiting for activation", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.activate([
      {
        id: "effect-check",
        version: "1",
        effect: (host) =>
          host.plugin.check({ target: "inspection-plugin@latest" }).pipe(
            Effect.flip,
            Effect.tap((error) =>
              Effect.sync(() =>
                expect(error).toMatchObject({
                  _tag: "PluginCheckError",
                  message: expect.stringContaining("external client"),
                }),
              ),
            ),
            Effect.orDie,
            Effect.asVoid,
          ),
      },
      {
        ...PluginPromise.fromPromise({
          id: "promise-check",
          setup: async (host) => {
            await expect(host.plugin.check({ target: "inspection-plugin@latest" })).rejects.toThrow("external client")
          },
        }),
        version: "1",
      },
    ])
    expect((yield* plugins.list()).map((plugin) => plugin.status)).toEqual(["active", "active"])
  }),
)

it.live("checks configured package sources without installing, writing config, or updating plugins", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("plugin-check-")))
    const target = "inspection-plugin@latest"
    const unsupported = "https://example.com/plugin.tgz"
    const config = JSON.stringify({ plugins: ["-*", target, unsupported] })
    const configPath = path.join(tmp.path, "opencode.json")
    yield* Effect.promise(() => Bun.write(configPath, config))
    let adds = 0
    let checks = 0
    let fail = false
    const context = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([LocationServiceMap.node, Bus.node]), [
        [Global.node, tempGlobalLayer],
        [
          Npm.node,
          Layer.succeed(Npm.Service, {
            add: () => {
              adds++
              return Effect.fail(new Npm.InstallFailedError({ dir: tmp.path }))
            },
            resolve: () => Effect.succeed({ directory: tmp.path }),
            which: () => Effect.undefined,
            check: () => {
              checks++
              if (fail)
                return Effect.fail(
                  new Npm.InstallFailedError({ dir: tmp.path, cause: new Error("registry unavailable") }),
                )
              return Effect.succeed({ available: "2.0.0", mutable: true })
            },
          }),
        ],
      ]),
    )
    const locations = yield* LocationServiceMap.Service.pipe(Effect.provide(context))
    const bus = yield* Bus.Service.pipe(Effect.provide(context))
    yield* Effect.gen(function* () {
      const supervisor = yield* PluginSupervisor.Service
      const plugins = yield* Plugin.Service
      yield* supervisor.flush
      const inventory = yield* plugins.list()
      const initialAdds = adds
      let updates = 0
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          if (event.type === Plugin.Event.Updated.type) updates++
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      expect(yield* supervisor.check(target)).toEqual({ available: "2.0.0", mutable: true })
      expect(yield* supervisor.check("not-configured@latest").pipe(Effect.flip)).toMatchObject({
        _tag: "PluginCheckError",
        message: expect.stringContaining("server inventory"),
      })
      expect(yield* supervisor.check(unsupported).pipe(Effect.flip)).toMatchObject({
        _tag: "PluginCheckError",
        message: `Unsupported plugin package source: ${unsupported}`,
      })
      expect(checks).toBe(1)
      fail = true
      expect(yield* supervisor.check(target).pipe(Effect.flip)).toMatchObject({
        _tag: "PluginCheckError",
        message: expect.stringContaining("registry unavailable"),
      })
      expect(adds).toBe(initialAdds)
      expect(yield* plugins.list()).toEqual(inventory)
      expect(updates).toBe(0)
      expect(yield* Effect.promise(() => Bun.file(configPath).text())).toBe(config)
    }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }))))
  }),
)
