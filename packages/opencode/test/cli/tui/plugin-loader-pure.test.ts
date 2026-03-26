import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("skips external tui plugins in pure mode", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "called.txt")
      const meta = path.join(dir, "plugin-meta.json")

      await Bun.write(
        file,
        `export default {
  id: "demo.pure",
  tui: async (_api, options) => {
    if (!options?.marker) return
    await Bun.write(options.marker, "called")
  },
}
`,
      )

      return { spec, marker, meta }
    },
  })

  const pure = process.env.OPENCODE_PURE
  const meta = process.env.OPENCODE_PLUGIN_META_FILE
  process.env.OPENCODE_PURE = "1"
  process.env.OPENCODE_PLUGIN_META_FILE = tmp.extra.meta

  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_meta: {
      [tmp.extra.spec]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    if (pure === undefined) {
      delete process.env.OPENCODE_PURE
    } else {
      process.env.OPENCODE_PURE = pure
    }
    if (meta === undefined) {
      delete process.env.OPENCODE_PLUGIN_META_FILE
    } else {
      process.env.OPENCODE_PLUGIN_META_FILE = meta
    }
  }
})
