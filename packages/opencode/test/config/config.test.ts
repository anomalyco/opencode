import { test, expect } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"

async function withHotReloadFlag<T>(value: string | undefined, fn: () => Promise<T>) {
  const previous = process.env.OPENCODE_CONFIG_HOT_RELOAD
  if (typeof value === "string") {
    process.env.OPENCODE_CONFIG_HOT_RELOAD = value
  } else {
    delete process.env.OPENCODE_CONFIG_HOT_RELOAD
  }
  try {
    return await fn()
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCODE_CONFIG_HOT_RELOAD
    } else {
      process.env.OPENCODE_CONFIG_HOT_RELOAD = previous
    }
  }
}

function scopedPluginFixture() {
  return tmpdir({
    init: async (dir) => {
      const pluginDir = path.join(dir, "node_modules", "@scope", "plugin")
      await fs.mkdir(pluginDir, { recursive: true })

      await Bun.write(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "config-fixture", version: "1.0.0", type: "module" }, null, 2),
      )

      await Bun.write(
        path.join(pluginDir, "package.json"),
        JSON.stringify(
          {
            name: "@scope/plugin",
            version: "1.0.0",
            type: "module",
            main: "./index.js",
          },
          null,
          2,
        ),
      )

      await Bun.write(path.join(pluginDir, "index.js"), "export default {}\n")

      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["@scope/plugin"] }, null, 2),
      )
    },
  })
}

test("loads config with defaults when no files exist", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.username).toBeDefined()
    },
  })
})

test("loads JSON config file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: "test/model",
          username: "testuser",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("test/model")
      expect(config.username).toBe("testuser")
    },
  })
})

test("loads JSONC config file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.jsonc"),
        `{
        // This is a comment
        "$schema": "https://opencode.ai/config.json",
        "model": "test/model",
        "username": "testuser"
      }`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("test/model")
      expect(config.username).toBe("testuser")
    },
  })
})

test("merges multiple config files with correct precedence", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.jsonc"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: "base",
          username: "base",
        }),
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: "override",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("override")
      expect(config.username).toBe("base")
    },
  })
})

test("handles environment variable substitution", async () => {
  const originalEnv = process.env["TEST_VAR"]
  process.env["TEST_VAR"] = "test_theme"

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            theme: "{env:TEST_VAR}",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.theme).toBe("test_theme")
      },
    })
  } finally {
    if (originalEnv !== undefined) {
      process.env["TEST_VAR"] = originalEnv
    } else {
      delete process.env["TEST_VAR"]
    }
  }
})

test("handles file inclusion substitution", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "included.txt"), "test_theme")
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          theme: "{file:included.txt}",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.theme).toBe("test_theme")
    },
  })
})

test("validates config schema and throws on invalid fields", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          invalid_field: "should cause error",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Strict schema should throw an error for invalid fields
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("throws error for invalid JSON", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), "{ invalid json }")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("handles agent configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            test_agent: {
              model: "test/model",
              temperature: 0.7,
              description: "test agent",
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["test_agent"]).toEqual({
        model: "test/model",
        temperature: 0.7,
        description: "test agent",
      })
    },
  })
})

test("preserves scoped plugin specifiers and resolves relative plugin paths", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginDir = path.join(dir, "local-plugins")
      await fs.mkdir(pluginDir, { recursive: true })
      const pluginFile = path.join(pluginDir, "custom.ts")
      await Bun.write(pluginFile, "export default {}")
      await Bun.write(
        path.join(dir, "opencode.jsonc"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: ["@promethean-os/opencode-openai-codex-auth", "./local-plugins/custom.ts"],
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.plugin).toContain("@promethean-os/opencode-openai-codex-auth")
      const pluginFileUrl = pathToFileURL(path.join(tmp.path, "local-plugins", "custom.ts")).href
      expect(config.plugin).toContain(pluginFileUrl)
    },
  })
})

test("handles command configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          command: {
            test_command: {
              template: "test template",
              description: "test command",
              agent: "test_agent",
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.command?.["test_command"]).toEqual({
        template: "test template",
        description: "test command",
        agent: "test_agent",
      })
    },
  })
})

test("migrates autoshare to share field", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          autoshare: true,
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.share).toBe("auto")
      expect(config.autoshare).toBe(true)
    },
  })
})

test("migrates mode field to agent field", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mode: {
            test_mode: {
              model: "test/model",
              temperature: 0.5,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["test_mode"]).toEqual({
        model: "test/model",
        temperature: 0.5,
        mode: "primary",
      })
    },
  })
})

test("loads config from .opencode directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      await fs.mkdir(opencodeDir, { recursive: true })
      const agentDir = path.join(opencodeDir, "agent")
      await fs.mkdir(agentDir, { recursive: true })

      await Bun.write(
        path.join(agentDir, "test.md"),
        `---
model: test/model
---
Test agent prompt`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["test"]).toEqual({
        name: "test",
        model: "test/model",
        prompt: "Test agent prompt",
      })
    },
  })
})

test("updates config and writes to file", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const newConfig = { model: "updated/model" }
      const result = await Config.update({ update: newConfig as any })

      const writtenConfig = JSON.parse(await Bun.file(result.filepath).text())
      expect(writtenConfig.model).toBe("updated/model")
    },
  })
})

test("gets config directories", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Config.directories()
      expect(dirs.length).toBeGreaterThanOrEqual(1)
    },
  })
})

test("does not rewrite scoped npm plugins even when hot reload is enabled", async () => {
  await withHotReloadFlag("true", async () => {
    await using tmp = await scopedPluginFixture()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.plugin).toContain("@scope/plugin")
      },
    })
  })
})

test("keeps scoped npm plugin identifiers when hot reload is disabled", async () => {
  await withHotReloadFlag(undefined, async () => {
    await using tmp = await scopedPluginFixture()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.plugin).toContain("@scope/plugin")
      },
    })
  })
})

test("appends plugins discovered from directories after merging config files", async () => {
  await using globalTmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "plugin"), { recursive: true })
      await Bun.write(path.join(dir, "plugin", "custom.ts"), "export const plugin = {}")
      await Bun.write(
        path.join(dir, "opencode.jsonc"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: ["global-plugin"],
        }),
      )
    },
  })

  await using workspace = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
      await Bun.write(
        path.join(dir, ".opencode", "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: ["local-plugin"],
        }),
      )
    },
  })

  const previousGlobalConfig = Global.Path.config
  ;(Global.Path as any).config = globalTmp.path
  try {
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.plugin).toEqual(["local-plugin", `file://${path.join(globalTmp.path, "plugin", "custom.ts")}`])
      },
    })
  } finally {
    ;(Global.Path as any).config = previousGlobalConfig
  }
})
