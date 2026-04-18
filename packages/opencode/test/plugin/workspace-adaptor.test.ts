import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Flag } = await import("../../src/flag/flag")
const { Plugin } = await import("../../src/plugin/index")
const { Workspace } = await import("../../src/control-plane/workspace")
const { Instance } = await import("../../src/project/instance")

const experimental = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true

afterEach(async () => {
  await Instance.disposeAll()
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
  test("plugin can install a workspace adaptor", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const type = `plug-${Math.random().toString(36).slice(2)}`
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "created.json")
        const space = path.join(dir, "space")
        await Bun.write(
          file,
          [
            "export default async ({ experimental_workspace }) => {",
            `  experimental_workspace.register(${JSON.stringify(type)}, {`,
            '    name: "plug",',
            '    description: "plugin workspace adaptor",',
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
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify(
            {
              $schema: "https://opencode.ai/config.json",
              plugin: [pathToFileURL(file).href],
            },
            null,
            2,
          ),
        )

        return { mark, space, type }
      },
    })

    const info = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          yield* plugin.init()
          return Workspace.create({
            type: tmp.extra.type,
            branch: null,
            extra: { key: "value" },
            projectID: Instance.project.id,
          })
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.runPromise),
    })

    expect(info.type).toBe(tmp.extra.type)
    expect(info.name).toBe("plug")
    expect(info.branch).toBe("plug/main")
    expect(info.directory).toBe(tmp.extra.space)
    expect(info.extra).toEqual({ key: "value" })
    expect(JSON.parse(await Bun.file(tmp.extra.mark).text())).toMatchObject({
      type: tmp.extra.type,
      name: "plug",
      branch: "plug/main",
      directory: tmp.extra.space,
      extra: { key: "value" },
    })
  })
})
