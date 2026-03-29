import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("toggles plugin runtime state by exported id", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "toggle-plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "toggle.txt")

      await Bun.write(
        file,
        `export default {
  id: "demo.toggle",
  tui: async (api, options) => {
    const text = await Bun.file(options.marker).text().catch(() => "")
    await Bun.write(options.marker, text + "start\\n")
    api.lifecycle.onDispose(async () => {
      const next = await Bun.file(options.marker).text().catch(() => "")
      await Bun.write(options.marker, next + "stop\\n")
    })
  },
}
`,
      )

      return {
        spec,
        marker,
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_enabled: {
      "demo.toggle": false,
    },
    plugin_meta: {
      [tmp.extra.spec]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi()

  try {
    await TuiPluginRuntime.init(api)

    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().find((item) => item.id === "demo.toggle")).toEqual({
      id: "demo.toggle",
      source: "file",
      spec: tmp.extra.spec,
      target: tmp.extra.spec,
      enabled: false,
      active: false,
    })

    await expect(TuiPluginRuntime.activatePlugin("demo.toggle")).resolves.toBe(true)
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("start\n")
    expect(api.kv.get("plugin_enabled", {})).toEqual({
      "demo.toggle": true,
    })

    await expect(TuiPluginRuntime.deactivatePlugin("demo.toggle")).resolves.toBe(true)
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("start\nstop\n")
    expect(api.kv.get("plugin_enabled", {})).toEqual({
      "demo.toggle": false,
    })

    await expect(TuiPluginRuntime.activatePlugin("missing.id")).resolves.toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("kv plugin_enabled overrides tui config on startup", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "startup-plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "startup.txt")

      await Bun.write(
        file,
        `export default {
  id: "demo.startup",
  tui: async (_api, options) => {
    await Bun.write(options.marker, "on")
  },
}
`,
      )

      return {
        spec,
        marker,
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_enabled: {
      "demo.startup": false,
    },
    plugin_meta: {
      [tmp.extra.spec]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi()
  api.kv.set("plugin_enabled", {
    "demo.startup": true,
  })

  try {
    await TuiPluginRuntime.init(api)

    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("on")
    expect(TuiPluginRuntime.list().find((item) => item.id === "demo.startup")).toEqual({
      id: "demo.startup",
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
