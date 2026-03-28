import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("adds tui plugin at runtime from spec", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "add-plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "add.txt")

      await Bun.write(
        file,
        `export default {
  id: "demo.add",
  tui: async () => {
    await Bun.write(${JSON.stringify(marker)}, "called")
  },
}
`,
      )

      return { spec, marker }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [],
    plugin_meta: undefined,
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())

    await expect(TuiPluginRuntime.addPlugin(tmp.extra.spec)).resolves.toBe(true)
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("called")
    expect(TuiPluginRuntime.list().find((item) => item.id === "demo.add")).toEqual({
      id: "demo.add",
      source: "file",
      spec: tmp.extra.spec,
      target: tmp.extra.spec,
      enabled: true,
      active: true,
    })
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})
