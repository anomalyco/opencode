import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import path from "path"
import { pathToFileURL } from "url"
import { Auth } from "../../src/auth"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Workspace } from "../../src/control-plane/workspace"
import { Plugin } from "../../src/plugin/index"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Vcs } from "../../src/project/vcs"
import { InstanceState } from "../../src/effect/instance-state"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

const configLayer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(AccountTest.empty),
  Layer.provide(NpmTest.noop),
  Layer.provide(FetchHttpClient.layer),
)
const pluginLayer = Plugin.layer.pipe(
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(configLayer),
  Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
)
const noopBootstrapLayer = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const workspaceLayer = Workspace.layer.pipe(
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(Vcs.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrapLayer))),
  Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: true })),
)
const it = testEffect(Layer.mergeAll(pluginLayer, workspaceLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await disposeAllInstances()
})

describe("plugin.workspace", () => {
  it.instance("plugin can install a workspace adapter", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
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
      const ctx = yield* InstanceState.context
      const info = yield* workspace.create({
        type,
        branch: null,
        extra: { key: "value" },
        projectID: ctx.project.id,
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
  )
})
