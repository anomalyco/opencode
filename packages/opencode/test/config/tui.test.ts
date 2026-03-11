import { afterEach, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { TuiConfig } from "../../src/config/tui"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"

const managedConfigDir = process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR!

afterEach(async () => {
  delete process.env.OPENCODE_CONFIG
  delete process.env.OPENCODE_TUI_CONFIG
  await fs.rm(path.join(Global.Path.config, "tui.json"), { force: true }).catch(() => {})
  await fs.rm(path.join(Global.Path.config, "tui.jsonc"), { force: true }).catch(() => {})
  await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("local")
      expect(config.diff_style).toBe("stacked")
    },
  })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
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
    },
  })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("project-migrated")
      expect(config.scroll_speed).toBe(2)
      expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(true)

      const server = JSON.parse(await Filesystem.readText(path.join(tmp.path, "opencode.json")))
      expect(server.theme).toBeUndefined()
      expect(server.tui).toBeUndefined()
    },
  })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("migrated-theme")
      expect(config.scroll_speed).toBe(2)

      const text = await Filesystem.readText(path.join(tmp.path, "tui.json"))
      const migrated = JSON.parse(text)
      expect(migrated.scroll_speed).toBe(2)
      expect(migrated.foo).toBeUndefined()
    },
  })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBeUndefined()
      expect(config.scroll_speed).toBeUndefined()
      expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(false)
      expect(await Filesystem.exists(path.join(tmp.path, "opencode.jsonc.tui-migration.bak"))).toBe(false)
      const source = await Filesystem.readText(path.join(tmp.path, "opencode.jsonc"))
      expect(source).toContain('"theme": "broken-theme"')
      expect(source).toContain('"tui": { "scroll_speed": 2 }')
    },
  })
})

test("skips migration when tui.json already exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ theme: "legacy" }, null, 2))
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ diff_style: "stacked" }, null, 2))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.diff_style).toBe("stacked")
      expect(config.theme).toBeUndefined()

      const server = JSON.parse(await Filesystem.readText(path.join(tmp.path, "opencode.json")))
      expect(server.theme).toBe("legacy")
      expect(await Filesystem.exists(path.join(tmp.path, "opencode.json.tui-migration.bak"))).toBe(false)
    },
  })
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
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await TuiConfig.get()
        expect(config.theme).toBe("readonly-theme")
        expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(true)

        const server = JSON.parse(await Filesystem.readText(source))
        expect(server.theme).toBe("readonly-theme")
      },
    })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await TuiConfig.get()
      const backup = await Filesystem.readText(path.join(tmp.path, "opencode.jsonc.tui-migration.bak"))
      expect(backup).toContain("// top-level comment")
      expect(backup).toContain("// nested comment")
      expect(backup).toContain('"theme": "jsonc-theme"')
      expect(backup).toContain('"scroll_speed": 1.5')
    },
  })
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

  await Instance.provide({
    directory: path.join(tmp.path, "apps", "client"),
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("nested-theme")
      expect(await Filesystem.exists(path.join(tmp.path, "tui.json"))).toBe(true)
      expect(await Filesystem.exists(path.join(tmp.path, "apps", "client", "tui.json"))).toBe(true)
    },
  })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.scroll_speed).toBe(3)
      expect(config.diff_style).toBe("stacked")
      // top-level keys take precedence over nested tui keys
      expect(config.theme).toBe("outer")
    },
  })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.diff_style).toBe("auto")
      expect(config.scroll_speed).toBe(2)
    },
  })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      // project tui.json overrides the custom path, same as server config precedence
      expect(config.theme).toBe("project")
      // project also set diff_style, so that wins
      expect(config.diff_style).toBe("auto")
    },
  })
})

test("merges keybind overrides across precedence layers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(Global.Path.config, "tui.json"), JSON.stringify({ keybinds: { app_exit: "ctrl+q" } }))
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ keybinds: { theme_list: "ctrl+k" } }))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.keybinds?.app_exit).toBe("ctrl+q")
      expect(config.keybinds?.theme_list).toBe("ctrl+k")
    },
  })
})

test("OPENCODE_TUI_CONFIG provides settings when no project config exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const custom = path.join(dir, "custom-tui.json")
      await Bun.write(custom, JSON.stringify({ theme: "from-env", diff_style: "stacked" }))
      process.env.OPENCODE_TUI_CONFIG = custom
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("from-env")
      expect(config.diff_style).toBe("stacked")
    },
  })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBeUndefined()
    },
  })
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

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await TuiConfig.get()
        expect(config.theme).toBe("env-theme")
        expect(config.keybinds?.app_exit).toBe("ctrl+q")
      },
    })
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("resolved-theme")
    },
  })
})

test("loads managed tui config and gives it highest precedence", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ theme: "project-theme" }, null, 2))
      await fs.mkdir(managedConfigDir, { recursive: true })
      await Bun.write(path.join(managedConfigDir, "tui.json"), JSON.stringify({ theme: "managed-theme" }, null, 2))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("managed-theme")
    },
  })
})

test("loads .opencode/tui.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
      await Bun.write(path.join(dir, ".opencode", "tui.json"), JSON.stringify({ diff_style: "stacked" }, null, 2))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.diff_style).toBe("stacked")
    },
  })
})

test("gracefully falls back when tui.json has invalid JSON", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), "{ invalid json }")
      await fs.mkdir(managedConfigDir, { recursive: true })
      await Bun.write(path.join(managedConfigDir, "tui.json"), JSON.stringify({ theme: "managed-fallback" }, null, 2))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("managed-fallback")
      expect(config.keybinds).toBeDefined()
    },
  })
})
