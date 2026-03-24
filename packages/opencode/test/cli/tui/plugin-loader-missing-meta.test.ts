import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("continues loading tui plugins when a plugin is missing config metadata", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const badPluginPath = path.join(dir, "missing-meta-plugin.ts")
      const nextPluginPath = path.join(dir, "next-plugin.ts")
      const plainPluginPath = path.join(dir, "plain-plugin.ts")
      const badSpec = pathToFileURL(badPluginPath).href
      const nextSpec = pathToFileURL(nextPluginPath).href
      const plainSpec = pathToFileURL(plainPluginPath).href
      const badMarker = path.join(dir, "missing-meta-called.txt")
      const nextMarker = path.join(dir, "next-called.txt")
      const plainMarker = path.join(dir, "plain-called.txt")

      await Bun.write(
        badPluginPath,
        `export default {
  tui: async (_api, options) => {
    if (!options?.marker) return
    await Bun.write(options.marker, "called")
  },
}
`,
      )

      await Bun.write(
        nextPluginPath,
        `export default {
  tui: async (_api, options) => {
    if (!options?.marker) return
    await Bun.write(options.marker, "called")
  },
}
`,
      )

      await Bun.write(
        plainPluginPath,
        `export default {
  tui: async (_api, options) => {
    await Bun.write(${JSON.stringify(plainMarker)}, options === undefined ? "undefined" : options === null ? "null" : "value")
  },
}
`,
      )

      return {
        badSpec,
        nextSpec,
        plainSpec,
        badMarker,
        nextMarker,
        plainMarker,
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const next = path.parse(new URL(tmp.extra.nextSpec).pathname).name
  const plain = path.parse(new URL(tmp.extra.plainSpec).pathname).name
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [
      [tmp.extra.badSpec, { marker: tmp.extra.badMarker }],
      [tmp.extra.nextSpec, { marker: tmp.extra.nextMarker }],
      tmp.extra.plainSpec,
    ],
    plugin_meta: {
      [next]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
      [plain]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()

  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())

    await expect(fs.readFile(tmp.extra.badMarker, "utf8")).rejects.toThrow()
    await expect(fs.readFile(tmp.extra.nextMarker, "utf8")).resolves.toBe("called")
    await expect(fs.readFile(tmp.extra.plainMarker, "utf8")).resolves.toBe("undefined")
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})
