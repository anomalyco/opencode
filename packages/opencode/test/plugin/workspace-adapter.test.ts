import { afterAll, afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { pathToFileURL } from "url"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Flag } = await import("@opencode-ai/core/flag/flag")
const { Plugin } = await import("../../src/plugin/index")
const { Workspace } = await import("../../src/control-plane/workspace")
const { Instance } = await import("../../src/project/instance")
const it = testEffect(Layer.mergeAll(Plugin.defaultLayer, Workspace.defaultLayer, CrossSpawnSpawner.defaultLayer))

const experimental = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true

afterEach(async () => {
  await disposeAllInstances()
})

afterAll(() => {
  if (disableDefault === undefined) {
    delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
  } else {
    process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disableDefault
  }

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
