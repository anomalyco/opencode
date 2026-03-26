import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/config/tui"
import { BunProc } from "../../../src/bun"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

function rec(value: unknown) {
  if (!value || typeof value !== "object") return
  return Object.fromEntries(Object.entries(value))
}

test("loads npm tui plugin from package ./tui export", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "acme-plugin")
      const marker = path.join(dir, "tui-called.txt")
      await fs.mkdir(mod, { recursive: true })

      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify(
          {
            name: "acme-plugin",
            type: "module",
            exports: {
              ".": "./index.js",
              "./server": "./server.js",
              "./tui": "./tui.js",
            },
          },
          null,
          2,
        ),
      )
      await Bun.write(path.join(mod, "index.js"), 'import "./main-throws.js"\nexport default {}\n')
      await Bun.write(path.join(mod, "main-throws.js"), 'throw new Error("main loaded")\n')
      await Bun.write(path.join(mod, "server.js"), "export default {}\n")
      await Bun.write(
        path.join(mod, "tui.js"),
        [
          "export default {",
          '  id: "demo.tui.export",',
          "  tui: async (_api, options) => {",
          "    if (!options?.marker) return",
          `    await Bun.write(${JSON.stringify(marker)}, "called")`,
          "  },",
          "}",
          "",
        ].join("\n"),
      )

      return {
        mod,
        marker,
        spec: "acme-plugin@1.0.0",
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
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
  const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())

    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("called")
    expect(TuiPluginRuntime.list().find((item) => item.id === "demo.tui.export")).toEqual({
      id: "demo.tui.export",
      source: "npm",
      spec: tmp.extra.spec,
      target: tmp.extra.mod,
      enabled: true,
      active: true,
    })
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
        JSON.stringify(
          {
            name: "acme-plugin",
            type: "module",
            exports: {
              ".": "./index.js",
              "./tui": "./escape/tui.js",
            },
          },
          null,
          2,
        ),
      )
      await Bun.write(path.join(mod, "index.js"), "export default {}\n")
      await Bun.write(
        path.join(outside, "tui.js"),
        [
          "export default {",
          '  id: "demo.outside",',
          "  tui: async () => {",
          `    await Bun.write(${JSON.stringify(marker)}, "outside")`,
          "  },",
          "}",
          "",
        ].join("\n"),
      )
      await fs.symlink(outside, path.join(mod, "escape"), process.platform === "win32" ? "junction" : "dir")

      return {
        mod,
        marker,
        spec: "acme-plugin@1.0.0",
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [tmp.extra.spec],
    plugin_meta: {
      [tmp.extra.spec]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(BunProc, "install").mockResolvedValue(tmp.extra.mod)
  const err = spyOn(console, "error").mockImplementation(() => {})

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())

    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)

    const hit = err.mock.calls.find(
      (item) => typeof item[0] === "string" && item[0].includes("failed to resolve tui plugin entry"),
    )
    expect(hit).toBeDefined()
    if (!hit) return

    const data = rec(hit[1])
    expect(data).toBeDefined()
    if (!data) return
    expect(data.path).toBe(tmp.extra.spec)
    expect(data.target).toBe(tmp.extra.mod)
    const info = rec(data.error)
    expect(info).toBeDefined()
    if (!info) return
    expect(String(info.message ?? "")).toContain("outside plugin directory")
  } finally {
    await TuiPluginRuntime.dispose()
    err.mockRestore()
    install.mockRestore()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})
