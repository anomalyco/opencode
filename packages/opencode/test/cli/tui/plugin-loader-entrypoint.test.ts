import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/cli/cmd/tui/config/tui"
import { Npm } from "../../../src/npm"

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
  const config: TuiConfig.Info = {
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_origins: [
      {
        spec: [tmp.extra.spec, { marker: tmp.extra.marker }],
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  }
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(Npm, "add").mockResolvedValue({ directory: tmp.extra.mod, entrypoint: undefined })

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("called")
    const hit = TuiPluginRuntime.list().find((item) => item.id === "demo.tui.export")
    expect(hit?.enabled).toBe(true)
    expect(hit?.active).toBe(true)
    expect(hit?.source).toBe("npm")
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("does not use npm package exports dot for tui entry", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "acme-plugin")
      const marker = path.join(dir, "dot-called.txt")
      await fs.mkdir(mod, { recursive: true })

      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify({
          name: "acme-plugin",
          type: "module",
          exports: { ".": "./index.js" },
        }),
      )
      await Bun.write(
        path.join(mod, "index.js"),
        `export default {
  id: "demo.dot",
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
  const config: TuiConfig.Info = {
    plugin: [tmp.extra.spec],
    plugin_origins: [
      {
        spec: tmp.extra.spec,
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  }
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(Npm, "add").mockResolvedValue({ directory: tmp.extra.mod, entrypoint: undefined })

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
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
  const config: TuiConfig.Info = {
    plugin: [tmp.extra.spec],
    plugin_origins: [
      {
        spec: tmp.extra.spec,
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  }
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(Npm, "add").mockResolvedValue({ directory: tmp.extra.mod, entrypoint: undefined })

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    // plugin code never ran
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    // plugin not listed
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
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
  const config: TuiConfig.Info = {
    plugin: [tmp.extra.spec],
    plugin_origins: [
      {
        spec: tmp.extra.spec,
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  }
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(Npm, "add").mockResolvedValue({ directory: tmp.extra.mod, entrypoint: undefined })

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("does not use npm package main for tui entry", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "acme-plugin")
      const marker = path.join(dir, "main-called.txt")
      await fs.mkdir(mod, { recursive: true })

      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify({
          name: "acme-plugin",
          type: "module",
          main: "./index.js",
        }),
      )
      await Bun.write(
        path.join(mod, "index.js"),
        `export default {
  id: "demo.main",
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
  const config: TuiConfig.Info = {
    plugin: [tmp.extra.spec],
    plugin_origins: [
      {
        spec: tmp.extra.spec,
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  }
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(Npm, "add").mockResolvedValue({ directory: tmp.extra.mod, entrypoint: undefined })
  const warn = spyOn(console, "warn").mockImplementation(() => {})
  const error = spyOn(console, "error").mockImplementation(() => {})

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)
    expect(error).not.toHaveBeenCalled()
    expect(warn.mock.calls.some((call) => String(call[0]).includes("tui plugin has no entrypoint"))).toBe(true)
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
    wait.mockRestore()
    warn.mockRestore()
    error.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("does not use directory package main for tui entry", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "dir-plugin")
      const spec = pathToFileURL(mod).href
      const marker = path.join(dir, "dir-main-called.txt")
      await fs.mkdir(mod, { recursive: true })

      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify({
          name: "dir-plugin",
          type: "module",
          main: "./main.js",
        }),
      )
      await Bun.write(
        path.join(mod, "main.js"),
        `export default {
  id: "demo.dir.main",
  tui: async () => {
    await Bun.write(${JSON.stringify(marker)}, "called")
  },
}
`,
      )

      return { marker, spec }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const config: TuiConfig.Info = {
    plugin: [tmp.extra.spec],
    plugin_origins: [
      {
        spec: tmp.extra.spec,
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  }
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("uses directory index fallback for tui when package.json is missing", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "dir-index")
      const spec = pathToFileURL(mod).href
      const marker = path.join(dir, "dir-index-called.txt")
      await fs.mkdir(mod, { recursive: true })
      await Bun.write(
        path.join(mod, "index.ts"),
        `export default {
  id: "demo.dir.index",
  tui: async () => {
    await Bun.write(${JSON.stringify(marker)}, "called")
  },
}
`,
      )
      return { marker, spec }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const config: TuiConfig.Info = {
    plugin: [tmp.extra.spec],
    plugin_origins: [
      {
        spec: tmp.extra.spec,
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  }
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("called")
    expect(TuiPluginRuntime.list().find((item) => item.id === "demo.dir.index")?.active).toBe(true)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("uses npm package name when tui plugin id is omitted", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "acme-plugin")
      const marker = path.join(dir, "name-id-called.txt")
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
  tui: async (_api, options) => {
    if (!options?.marker) return
    await Bun.write(options.marker, "called")
  },
}
`,
      )

      return { mod, marker, spec: "acme-plugin@1.0.0" }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const config: TuiConfig.Info = {
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_origins: [
      {
        spec: [tmp.extra.spec, { marker: tmp.extra.marker }],
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  }
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const install = spyOn(Npm, "add").mockResolvedValue({ directory: tmp.extra.mod, entrypoint: undefined })

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("called")
    expect(TuiPluginRuntime.list().find((item) => item.spec === tmp.extra.spec)?.id).toBe("acme-plugin")
  } finally {
    await TuiPluginRuntime.dispose()
    install.mockRestore()
    cwd.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})
