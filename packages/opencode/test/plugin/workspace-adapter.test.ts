import { afterAll, afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Flag } from "@opencode-ai/core/flag/flag"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Workspace } from "../../src/control-plane/workspace"
import { Plugin } from "../../src/plugin/index"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { Instance } from "../../src/project/instance"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { NpmTest } from "../fake/npm"

const emptyAccount = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})
const emptyAuth = Layer.mock(Auth.Service)({
  all: () => Effect.succeed({}),
})
const configLayer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptyAccount),
  Layer.provide(NpmTest.noop),
)
const pluginLayer = Plugin.layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(configLayer),
  Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
)
const noopBootstrapLayer = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const workspaceLayer = Workspace.defaultLayer.pipe(
  Layer.provide(InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrapLayer))),
)
const it = testEffect(Layer.mergeAll(pluginLayer, workspaceLayer, CrossSpawnSpawner.defaultLayer))

const experimental = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true

afterEach(async () => {
  await disposeAllInstances()
})

afterAll(() => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = experimental
})

describe("plugin.workspace", () => {
  it.live("plugin can install a workspace adapter", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const type = `plug-${Math.random().toString(36).slice(2)}`
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "created.json")
        const space = path.join(dir, "space")
        yield* Effect.promise(() =>
          Bun.write(
            file,
            [
              "export default async ({ experimental_workspace }) => {",
              `  experimental_workspace.register(${JSON.stringify(type)}, {`,
              '    name: "plug",',
              '    description: "plugin workspace adapter",',
              "    configure(input) {",
              `      return { ...input, name: "plug", branch: "plug/main", directory: ${JSON.stringify(space)} }`,
              "    },",
              "    async create(input) {",
              `      await Bun.write(${JSON.stringify(mark)}, JSON.stringify(input))`,
              "    },",
              "    async remove() {},",
              "    target(input) {",
              '      return { type: "local", directory: input.directory }',
              "    },",
              "  })",
              "  return {}",
              "}",
              "",
            ].join("\n"),
          ),
        )

        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: [pathToFileURL(file).href],
              },
              null,
              2,
            ),
          ),
        )

        const plugin = yield* Plugin.Service
        yield* plugin.init()
        const workspace = yield* Workspace.Service
        const info = yield* workspace.create({
          type,
          branch: null,
          extra: { key: "value" },
          projectID: Instance.project.id,
        })

        expect(info.type).toBe(type)
        expect(info.name).toBe("plug")
        expect(info.branch).toBe("plug/main")
        expect(info.directory).toBe(space)
        expect(info.extra).toEqual({ key: "value" })
        expect(JSON.parse(yield* Effect.promise(() => Bun.file(mark).text()))).toMatchObject({
          type,
          name: "plug",
          branch: "plug/main",
          directory: space,
          extra: { key: "value" },
        })
      }),
    ),
  )
})
