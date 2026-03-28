import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/config/tui"
import { BunProc } from "../../../src/bun"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("loads npm tui plugin from package ./tui export", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "acme-plugin")
      const marker = path.join(dir, "tui-called.txt")
      await fs.mkdir(mod, { recursive: true })

      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify({
          name: "acme-plugin",
          type: "module",
          exports: { ".": "./index.js", "./server": "./server.js", "./tui": "./tui.js" },
        }),
      )
      await Bun.write(path.join(mod, "index.js"), 'import "./main-throws.js"\nexport default {}\n')
      await Bun.write(path.join(mod, "main-throws.js"), 'throw new Error("main loaded")\n')
      await Bun.write(path.join(mod, "server.js"), "export default {}\n")
      await Bun.write(
        path.join(mod, "tui.js"),
        `export default {
  id: "demo.tui.export",
  tui: async (_api, options) => {
    if (!options?.marker) return
    await Bun.write(${JSON.stringify(marker)}, "called")
  },
}
`,
      )

      return { mod, marker, spec: "acme-plugin@1.0.0" }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_meta: {
      [tmp.extra.spec]: { scope: "local", source: path.join(tmp.path, "tui.json") },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("called")
    const hit = TuiPluginRuntime.list().find((item) => item.id === "demo.tui.export")
    expect(hit?.enabled).toBe(true)
    expect(hit?.active).toBe(true)
    expect(hit?.source).toBe("npm")
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("rejects npm tui export that resolves outside plugin directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "acme-plugin")
      const outside = path.join(dir, "outside")
      const marker = path.join(dir, "outside-called.txt")
      await fs.mkdir(mod, { recursive: true })
      await fs.mkdir(outside, { recursive: true })

      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify({
          name: "acme-plugin",
          type: "module",
          exports: { ".": "./index.js", "./tui": "./escape/tui.js" },
        }),
      )
      await Bun.write(path.join(mod, "index.js"), "export default {}\n")
      await Bun.write(
        path.join(outside, "tui.js"),
        `export default {
  id: "demo.outside",
  tui: async () => {
    await Bun.write(${JSON.stringify(marker)}, "outside")
  },
}
`,
      )
      await fs.symlink(outside, path.join(mod, "escape"), process.platform === "win32" ? "junction" : "dir")

      return { mod, marker, spec: "acme-plugin@1.0.0" }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [tmp.extra.spec],
    plugin_meta: {
      [tmp.extra.spec]: { scope: "local", source: path.join(tmp.path, "tui.json") },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())
    // plugin code never ran
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    // plugin not listed
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("rejects npm tui plugin that exports server and tui together", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "acme-plugin")
      const marker = path.join(dir, "mixed-called.txt")
      await fs.mkdir(mod, { recursive: true })

      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify({
          name: "acme-plugin",
          type: "module",
          exports: { ".": "./index.js", "./tui": "./tui.js" },
        }),
      )
      await Bun.write(path.join(mod, "index.js"), "export default {}\n")
      await Bun.write(
        path.join(mod, "tui.js"),
        `export default {
  id: "demo.mixed",
  server: async () => ({}),
  tui: async () => {
    await Bun.write(${JSON.stringify(marker)}, "called")
  },
}
`,
      )

      return { mod, marker, spec: "acme-plugin@1.0.0" }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [tmp.extra.spec],
    plugin_meta: {
      [tmp.extra.spec]: { scope: "local", source: path.join(tmp.path, "tui.json") },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})
