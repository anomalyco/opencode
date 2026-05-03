import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { InstanceRuntime } from "@/project/instance-runtime"
import { TuiConfig } from "../../src/cli/cmd/tui/config/tui"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Effect, Layer } from "effect"
import { CurrentWorkingDirectory } from "@/cli/cmd/tui/config/cwd"
import { ConfigPlugin } from "@/config/plugin"

const wintest = process.platform === "win32" ? test : test.skip
const clear = async (wait = false) => {
  await AppRuntime.runPromise(Config.Service.use((svc) => svc.invalidate()))
  if (wait) await InstanceRuntime.disposeAllInstances()
}
const load = () => AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))

beforeEach(async () => {
  await clear(true)
})

const getTuiConfig = async (directory: string) =>
  Effect.runPromise(
    TuiConfig.Service.use((svc) => svc.get()).pipe(
      Effect.provide(TuiConfig.defaultLayer.pipe(Layer.provide(Layer.succeed(CurrentWorkingDirectory, directory)))),
    ),
  )

afterEach(async () => {
  delete process.env.OPENCODE_CONFIG
  delete process.env.OPENCODE_TUI_CONFIG
  await fs.rm(path.join(Global.Path.config, "opencode.json"), { force: true }).catch(() => {})
  await fs.rm(path.join(Global.Path.config, "opencode.jsonc"), { force: true }).catch(() => {})
  await fs.rm(path.join(Global.Path.config, "tui.json"), { force: true }).catch(() => {})
  await fs.rm(path.join(Global.Path.config, "tui.jsonc"), { force: true }).catch(() => {})
  await clear(true)
})

test("keeps server and tui plugin merge semantics aligned", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const local = path.join(dir, ".opencode")
      await fs.mkdir(local, { recursive: true })

      await Bun.write(
        path.join(Global.Path.config, "opencode.json"),
        JSON.stringify(
          {
            plugin: [["shared-plugin@1.0.0", { source: "global" }], "global-only@1.0.0"],
          },
          null,
          2,
        ),
      )
      await Bun.write(
        path.join(Global.Path.config, "tui.json"),
        JSON.stringify(
          {
            plugin: [["shared-plugin@1.0.0", { source: "global" }], "global-only@1.0.0"],
          },
          null,
          2,
        ),
      )

      await Bun.write(
        path.join(local, "opencode.json"),
        JSON.stringify(
          {
            plugin: [["shared-plugin@2.0.0", { source: "local" }], "local-only@1.0.0"],
          },
          null,
          2,
        ),
      )
      await Bun.write(
        path.join(local, "tui.json"),
        JSON.stringify(
          {
            plugin: [["shared-plugin@2.0.0", { source: "local" }], "local-only@1.0.0"],
          },
          null,
          2,
        ),
      )
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const server = await load()
      const tui = await getTuiConfig(tmp.path)
      const serverPlugins = (server.plugin ?? []).map((item) => ConfigPlugin.pluginSpecifier(item))
      const tuiPlugins = (tui.plugin ?? []).map((item) => ConfigPlugin.pluginSpecifier(item))

      expect(serverPlugins).toEqual(tuiPlugins)
      expect(serverPlugins).toContain("shared-plugin@2.0.0")
      expect(serverPlugins).not.toContain("shared-plugin@1.0.0")

      const serverOrigins = server.plugin_origins ?? []
      const tuiOrigins = tui.plugin_origins ?? []
      expect(serverOrigins.map((item) => ConfigPlugin.pluginSpecifier(item.spec))).toEqual(serverPlugins)
      expect(tuiOrigins.map((item) => ConfigPlugin.pluginSpecifier(item.spec))).toEqual(tuiPlugins)
      expect(serverOrigins.map((item) => item.scope)).toEqual(tuiOrigins.map((item) => item.scope))
    },
  })
})

test("loads tui config with the same precedence order as server config paths", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(Global.Path.config, "tui.json"), JSON.stringify({ theme: "global" }, null, 2))
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ theme: "project" }, null, 2))
      await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
      await Bun.write(
        path.join(dir, ".opencode", "tui.json"),
        JSON.stringify({ theme: "local", diff_style: "stacked" }, null, 2),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.theme).toBe("local")
  expect(config.diff_style).toBe("stacked")
})

test("migrates tui-specific keys from opencode.json when tui.json does not exist", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            theme: "migrated-theme",
            tui: { scroll_speed: 5 },
            keybinds: { app_exit: "ctrl+q" },
          },
          null,
          2,
        ),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.theme).toBe("migrated-theme")
  expect(config.scroll_speed).toBe(5)
  expect(config.keybinds?.app_exit).toBe("ctrl+q")
  const text = await Filesystem.readText(path.join(tmp.path, "tui.json"))
  expect(JSON.parse(text)).toMatchObject({
    theme: "migrated-theme",
    scroll_speed: 5,
  })
  const server = JSON.parse(await Filesystem.readText(path.join(tmp.path, "opencode.json")))
  expect(server.theme).toBeUndefined()
  expect(server.keybinds).toBeUndefined()
  expect(server.tui).toBeUndefined()
  expect(await Filesystem.exists(path.join(tmp.path, "opencode.json.tui-migration.bak"))).toBe(true)
  expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(true)
})

test("migrates project legacy tui keys even when global tui.json already exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(Global.Path.config, "tui.json"), JSON.stringify({ theme: "global" }, null, 2))
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            theme: "project-migrated",
            tui: { scroll_speed: 2 },
          },
          null,
          2,
        ),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.theme).toBe("project-migrated")
  expect(config.scroll_speed).toBe(2)
  expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(true)

  const server = JSON.parse(await Filesystem.readText(path.join(tmp.path, "opencode.json")))
  expect(server.theme).toBeUndefined()
  expect(server.tui).toBeUndefined()
})

test("drops unknown legacy tui keys during migration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            theme: "migrated-theme",
            tui: { scroll_speed: 2, foo: 1 },
          },
          null,
          2,
        ),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.theme).toBe("migrated-theme")
  expect(config.scroll_speed).toBe(2)

  const text = await Filesystem.readText(path.join(tmp.path, "tui.json"))
  const migrated = JSON.parse(text)
  expect(migrated.scroll_speed).toBe(2)
  expect(migrated.foo).toBeUndefined()
})

test("skips migration when opencode.jsonc is syntactically invalid", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.jsonc"),
        `{
  "theme": "broken-theme",
  "tui": { "scroll_speed": 2 }
  "username": "still-broken"
}`,
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.theme).toBeUndefined()
  expect(config.scroll_speed).toBeUndefined()
  expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(false)
  expect(await Filesystem.exists(path.join(tmp.path, "opencode.jsonc.tui-migration.bak"))).toBe(false)
  const source = await Filesystem.readText(path.join(tmp.path, "opencode.jsonc"))
  expect(source).toContain('"theme": "broken-theme"')
  expect(source).toContain('"tui": { "scroll_speed": 2 }')
})

test("skips migration when tui.json already exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ theme: "legacy" }, null, 2))
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ diff_style: "stacked" }, null, 2))
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.diff_style).toBe("stacked")
  expect(config.theme).toBeUndefined()

  const server = JSON.parse(await Filesystem.readText(path.join(tmp.path, "opencode.json")))
  expect(server.theme).toBe("legacy")
  expect(await Filesystem.exists(path.join(tmp.path, "opencode.json.tui-migration.bak"))).toBe(false)
})

test("continues loading tui config when legacy source cannot be stripped", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ theme: "readonly-theme" }, null, 2))
    },
  })

  const source = path.join(tmp.path, "opencode.json")
  await fs.chmod(source, 0o444)

  try {
    const config = await getTuiConfig(tmp.path)
    expect(config.theme).toBe("readonly-theme")
    expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(true)

    const server = JSON.parse(await Filesystem.readText(source))
    expect(server.theme).toBe("readonly-theme")
  } finally {
    await fs.chmod(source, 0o644)
  }
})

test("migration backup preserves JSONC comments", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.jsonc"),
        `{
  // top-level comment
  "theme": "jsonc-theme",
  "tui": {
    // nested comment
    "scroll_speed": 1.5
  }
}`,
      )
    },
  })

  await getTuiConfig(tmp.path)
  const backup = await Filesystem.readText(path.join(tmp.path, "opencode.jsonc.tui-migration.bak"))
  expect(backup).toContain("// top-level comment")
  expect(backup).toContain("// nested comment")
  expect(backup).toContain('"theme": "jsonc-theme"')
  expect(backup).toContain('"scroll_speed": 1.5')
})

test("migrates legacy tui keys across multiple opencode.json levels", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const nested = path.join(dir, "apps", "client")
      await fs.mkdir(nested, { recursive: true })
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ theme: "root-theme" }, null, 2))
      await Bun.write(path.join(nested, "opencode.json"), JSON.stringify({ theme: "nested-theme" }, null, 2))
    },
  })
  const config = await getTuiConfig(path.join(tmp.path, "apps", "client"))
  expect(config.theme).toBe("nested-theme")
  expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(true)
  expect(await Filesystem.exists(path.join(tmp.path, "apps", "client", "tui.json"))).toBe(true)
})

test("flattens nested tui key inside tui.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "tui.json"),
        JSON.stringify({
          theme: "outer",
          tui: { scroll_speed: 3, diff_style: "stacked" },
        }),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.scroll_speed).toBe(3)
  expect(config.diff_style).toBe("stacked")
  // top-level keys take precedence over nested tui keys
  expect(config.theme).toBe("outer")
})

test("top-level keys in tui.json take precedence over nested tui key", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "tui.json"),
        JSON.stringify({
          diff_style: "auto",
          tui: { diff_style: "stacked", scroll_speed: 2 },
        }),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.diff_style).toBe("auto")
  expect(config.scroll_speed).toBe(2)
})

test("project config takes precedence over OPENCODE_TUI_CONFIG (matches OPENCODE_CONFIG)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ theme: "project", diff_style: "auto" }))
      const custom = path.join(dir, "custom-tui.json")
      await Bun.write(custom, JSON.stringify({ theme: "custom", diff_style: "stacked" }))
      process.env.OPENCODE_TUI_CONFIG = custom
    },
  })

  const config = await getTuiConfig(tmp.path)
  // project tui.json overrides the custom path, same as server config precedence
  expect(config.theme).toBe("project")
  // project also set diff_style, so that wins
  expect(config.diff_style).toBe("auto")
})

test("merges keybind overrides across precedence layers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(Global.Path.config, "tui.json"), JSON.stringify({ keybinds: { app_exit: "ctrl+q" } }))
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ keybinds: { theme_list: "ctrl+k" } }))
    },
  })
  const config = await getTuiConfig(tmp.path)
  expect(config.keybinds?.app_exit).toBe("ctrl+q")
  expect(config.keybinds?.theme_list).toBe("ctrl+k")
})

wintest("defaults Ctrl+Z to input undo on Windows", async () => {
  await using tmp = await tmpdir()
  const config = await getTuiConfig(tmp.path)
  expect(config.keybinds?.terminal_suspend).toBe("none")
  expect(config.keybinds?.input_undo).toBe("ctrl+z,ctrl+-,super+z")
})

wintest("keeps explicit input undo overrides on Windows", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ keybinds: { input_undo: "ctrl+y" } }))
    },
  })
  const config = await getTuiConfig(tmp.path)
  expect(config.keybinds?.terminal_suspend).toBe("none")
  expect(config.keybinds?.input_undo).toBe("ctrl+y")
})

wintest("ignores terminal suspend bindings on Windows", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ keybinds: { terminal_suspend: "alt+z" } }))
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.keybinds?.terminal_suspend).toBe("none")
  expect(config.keybinds?.input_undo).toBe("ctrl+z,ctrl+-,super+z")
})

test("OPENCODE_TUI_CONFIG provides settings when no project config exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const custom = path.join(dir, "custom-tui.json")
      await Bun.write(custom, JSON.stringify({ theme: "from-env", diff_style: "stacked" }))
      process.env.OPENCODE_TUI_CONFIG = custom
    },
  })
  const config = await getTuiConfig(tmp.path)
  expect(config.theme).toBe("from-env")
  expect(config.diff_style).toBe("stacked")
})

test("does not derive tui path from OPENCODE_CONFIG", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const customDir = path.join(dir, "custom")
      await fs.mkdir(customDir, { recursive: true })
      await Bun.write(path.join(customDir, "opencode.json"), JSON.stringify({ model: "test/model" }))
      await Bun.write(path.join(customDir, "tui.json"), JSON.stringify({ theme: "should-not-load" }))
      process.env.OPENCODE_CONFIG = path.join(customDir, "opencode.json")
    },
  })
  const config = await getTuiConfig(tmp.path)
  expect(config.theme).toBeUndefined()
})

test("applies env and file substitutions in tui.json", async () => {
  const original = process.env.TUI_THEME_TEST
  process.env.TUI_THEME_TEST = "env-theme"
  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "keybind.txt"), "ctrl+q")
        await Bun.write(
          path.join(dir, "tui.json"),
          JSON.stringify({
            theme: "{env:TUI_THEME_TEST}",
            keybinds: { app_exit: "{file:keybind.txt}" },
          }),
        )
      },
    })
    const config = await getTuiConfig(tmp.path)
    expect(config.theme).toBe("env-theme")
    expect(config.keybinds?.app_exit).toBe("ctrl+q")
  } finally {
    if (original === undefined) delete process.env.TUI_THEME_TEST
    else process.env.TUI_THEME_TEST = original
  }
})

test("applies file substitutions when first identical token is in a commented line", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "theme.txt"), "resolved-theme")
      await Bun.write(
        path.join(dir, "tui.jsonc"),
        `{
  // "theme": "{file:theme.txt}",
  "theme": "{file:theme.txt}"
}`,
      )
    },
  })
  const config = await getTuiConfig(tmp.path)
  expect(config.theme).toBe("resolved-theme")
})

test("loads .opencode/tui.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
      await Bun.write(path.join(dir, ".opencode", "tui.json"), JSON.stringify({ diff_style: "stacked" }, null, 2))
    },
  })
  const config = await getTuiConfig(tmp.path)
  expect(config.diff_style).toBe("stacked")
})

test("supports tuple plugin specs with options in tui.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "tui.json"),
        JSON.stringify({
          plugin: [["acme-plugin@1.2.3", { enabled: true, label: "demo" }]],
        }),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.plugin).toEqual([["acme-plugin@1.2.3", { enabled: true, label: "demo" }]])
  expect(config.plugin_origins).toEqual([
    {
      spec: ["acme-plugin@1.2.3", { enabled: true, label: "demo" }],
      scope: "local",
      source: path.join(tmp.path, "tui.json"),
    },
  ])
})

test("deduplicates tuple plugin specs by name with higher precedence winning", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(Global.Path.config, "tui.json"),
        JSON.stringify({
          plugin: [["acme-plugin@1.0.0", { source: "global" }]],
        }),
      )
      await Bun.write(
        path.join(dir, "tui.json"),
        JSON.stringify({
          plugin: [
            ["acme-plugin@2.0.0", { source: "project" }],
            ["second-plugin@3.0.0", { source: "project" }],
          ],
        }),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.plugin).toEqual([
    ["acme-plugin@2.0.0", { source: "project" }],
    ["second-plugin@3.0.0", { source: "project" }],
  ])
  expect(config.plugin_origins).toEqual([
    {
      spec: ["acme-plugin@2.0.0", { source: "project" }],
      scope: "local",
      source: path.join(tmp.path, "tui.json"),
    },
    {
      spec: ["second-plugin@3.0.0", { source: "project" }],
      scope: "local",
      source: path.join(tmp.path, "tui.json"),
    },
  ])
})

test("tracks global and local plugin metadata in merged tui config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(Global.Path.config, "tui.json"),
        JSON.stringify({
          plugin: ["global-plugin@1.0.0"],
        }),
      )
      await Bun.write(
        path.join(dir, "tui.json"),
        JSON.stringify({
          plugin: ["local-plugin@2.0.0"],
        }),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.plugin).toEqual(["global-plugin@1.0.0", "local-plugin@2.0.0"])
  expect(config.plugin_origins).toEqual([
    {
      spec: "global-plugin@1.0.0",
      scope: "global",
      source: path.join(Global.Path.config, "tui.json"),
    },
    {
      spec: "local-plugin@2.0.0",
      scope: "local",
      source: path.join(tmp.path, "tui.json"),
    },
  ])
})

test("merges plugin_enabled flags across config layers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(Global.Path.config, "tui.json"),
        JSON.stringify({
          plugin_enabled: {
            "internal:sidebar-context": false,
            "demo.plugin": true,
          },
        }),
      )
      await Bun.write(
        path.join(dir, "tui.json"),
        JSON.stringify({
          plugin_enabled: {
            "demo.plugin": false,
            "local.plugin": true,
          },
        }),
      )
    },
  })

  const config = await getTuiConfig(tmp.path)
  expect(config.plugin_enabled).toEqual({
    "internal:sidebar-context": false,
    "demo.plugin": false,
    "local.plugin": true,
  })
})

test("silently skips malformed tui.json — load failures degrade to {}", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), '{ "theme": "broken",')
      await Bun.write(path.join(dir, ".opencode", "tui.json"), JSON.stringify({ theme: "fallback" }))
    },
  })

  const config = await getTuiConfig(tmp.path)
  // Project tui.json is malformed → silently skipped (logs a warning)
  // .opencode/tui.json (lower precedence in this path) still loads
  expect(config.theme).toBe("fallback")
})

test("silently skips non-ENOENT read failures (e.g. tui.json is a directory) — fallback layer still loads", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // tui.json exists as a DIRECTORY rather than a file → readFileString fails
      // with EISDIR (PlatformError reason ≠ NotFound). The fix in this PR routes
      // that through catchCause → log + skip, so a fallback layer should still load.
      await fs.mkdir(path.join(dir, "tui.json"), { recursive: true })
      await Bun.write(path.join(dir, ".opencode", "tui.json"), JSON.stringify({ theme: "fallback" }))
    },
  })

  const config = await getTuiConfig(tmp.path)
  // Did NOT crash; .opencode/tui.json (lower precedence) still loads.
  expect(config.theme).toBe("fallback")
})

test("missing tui.json — silently treated as empty (ENOENT path)", async () => {
  await using tmp = await tmpdir({})

  // No tui.json anywhere. Should not throw.
  const config = await getTuiConfig(tmp.path)
  expect(config).toBeDefined()
  // No theme set anywhere.
  expect(config.theme).toBeUndefined()
})
