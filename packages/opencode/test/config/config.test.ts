import { test, expect, describe } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import os from "os"

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
      await Config.update(newConfig as any)

      const writtenConfig = JSON.parse(await Bun.file(path.join(tmp.path, "config.json")).text())
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

test("resolves scoped npm plugins in config", async () => {
  await using tmp = await tmpdir({
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const pluginEntries = config.plugin ?? []

      const baseUrl = pathToFileURL(path.join(tmp.path, "opencode.json")).href
      const expected = import.meta.resolve("@scope/plugin", baseUrl)

      expect(pluginEntries.includes(expected)).toBe(true)

      const scopedEntry = pluginEntries.find((entry) => entry === expected)
      expect(scopedEntry).toBeDefined()
      expect(scopedEntry?.includes("/node_modules/@scope/plugin/")).toBe(true)
    },
  })
})

test("merges plugin arrays from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a nested project structure with local .opencode config
      const projectDir = path.join(dir, "project")
      const opencodeDir = path.join(projectDir, ".opencode")
      await fs.mkdir(opencodeDir, { recursive: true })

      // Global config with plugins
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: ["global-plugin-1", "global-plugin-2"],
        }),
      )

      // Local .opencode config with different plugins
      await Bun.write(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: ["local-plugin-1"],
        }),
      )
    },
  })

  await Instance.provide({
    directory: path.join(tmp.path, "project"),
    fn: async () => {
      const config = await Config.get()
      const plugins = config.plugin ?? []

      // Should contain both global and local plugins
      expect(plugins.some((p) => p.includes("global-plugin-1"))).toBe(true)
      expect(plugins.some((p) => p.includes("global-plugin-2"))).toBe(true)
      expect(plugins.some((p) => p.includes("local-plugin-1"))).toBe(true)

      // Should have all 3 plugins (not replaced, but merged)
      const pluginNames = plugins.filter((p) => p.includes("global-plugin") || p.includes("local-plugin"))
      expect(pluginNames.length).toBeGreaterThanOrEqual(3)
    },
  })
})

test("deduplicates duplicate plugins from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a nested project structure with local .opencode config
      const projectDir = path.join(dir, "project")
      const opencodeDir = path.join(projectDir, ".opencode")
      await fs.mkdir(opencodeDir, { recursive: true })

      // Global config with plugins
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: ["duplicate-plugin", "global-plugin-1"],
        }),
      )

      // Local .opencode config with some overlapping plugins
      await Bun.write(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: ["duplicate-plugin", "local-plugin-1"],
        }),
      )
    },
  })

  await Instance.provide({
    directory: path.join(tmp.path, "project"),
    fn: async () => {
      const config = await Config.get()
      const plugins = config.plugin ?? []

      // Should contain all unique plugins
      expect(plugins.some((p) => p.includes("global-plugin-1"))).toBe(true)
      expect(plugins.some((p) => p.includes("local-plugin-1"))).toBe(true)
      expect(plugins.some((p) => p.includes("duplicate-plugin"))).toBe(true)

      // Should deduplicate the duplicate plugin
      const duplicatePlugins = plugins.filter((p) => p.includes("duplicate-plugin"))
      expect(duplicatePlugins.length).toBe(1)

      // Should have exactly 3 unique plugins
      const pluginNames = plugins.filter(
        (p) => p.includes("global-plugin") || p.includes("local-plugin") || p.includes("duplicate-plugin"),
      )
      expect(pluginNames.length).toBe(3)
    },
  })
})

// Unit tests for pattern-based external directory permission helpers
describe("getExternalDirectoryReadForPath", () => {
  test("returns permission when string", () => {
    expect(Config.getExternalDirectoryReadForPath("allow", "/any/path")).toBe("allow")
    expect(Config.getExternalDirectoryReadForPath("deny", "/any/path")).toBe("deny")
    expect(Config.getExternalDirectoryReadForPath("ask", "/any/path")).toBe("ask")
  })

  test("returns undefined when permission is undefined", () => {
    expect(Config.getExternalDirectoryReadForPath(undefined, "/any/path")).toBeUndefined()
  })

  test("returns permission from pattern map when path matches", () => {
    const permission = {
      read: {
        "/etc/**": "allow" as const,
        "*": "deny" as const,
      },
    }
    expect(Config.getExternalDirectoryReadForPath(permission, "/etc/hosts")).toBe("allow")
    expect(Config.getExternalDirectoryReadForPath(permission, "/etc/subdir/file")).toBe("allow")
    expect(Config.getExternalDirectoryReadForPath(permission, "/other/path")).toBe("deny")
  })

  test("returns catch-all (*) when no pattern matches", () => {
    const permission = {
      read: {
        "/nonexistent/**": "allow" as const,
        "*": "ask" as const,
      },
    }
    expect(Config.getExternalDirectoryReadForPath(permission, "/etc/hosts")).toBe("ask")
  })

  test("returns undefined when no pattern matches and no catch-all", () => {
    const permission = {
      read: {
        "/nonexistent/**": "deny" as const,
      },
    }
    expect(Config.getExternalDirectoryReadForPath(permission, "/etc/hosts")).toBeUndefined()
  })

  test("first matching pattern takes precedence", () => {
    const permission = {
      read: {
        "/etc/hosts": "allow" as const,
        "/etc/**": "deny" as const,
        "*": "ask" as const,
      },
    }
    expect(Config.getExternalDirectoryReadForPath(permission, "/etc/hosts")).toBe("allow")
  })

  test("expands ~ to home directory in patterns", () => {
    const homeDir = os.homedir()
    const permission = {
      read: {
        "~/.ssh/**": "deny" as const,
        "~/reference/**": "allow" as const,
        "*": "ask" as const,
      },
    }
    expect(Config.getExternalDirectoryReadForPath(permission, `${homeDir}/.ssh/id_rsa`)).toBe("deny")
    expect(Config.getExternalDirectoryReadForPath(permission, `${homeDir}/reference/doc.txt`)).toBe("allow")
    expect(Config.getExternalDirectoryReadForPath(permission, `${homeDir}/other/file.txt`)).toBe("ask")
  })

  test("returns simple read permission when read is string", () => {
    const permission = {
      read: "allow" as const,
      write: "deny" as const,
    }
    expect(Config.getExternalDirectoryReadForPath(permission, "/any/path")).toBe("allow")
  })
})

describe("getExternalDirectoryWriteForPath", () => {
  test("returns permission when string", () => {
    expect(Config.getExternalDirectoryWriteForPath("allow", "/any/path")).toBe("allow")
    expect(Config.getExternalDirectoryWriteForPath("deny", "/any/path")).toBe("deny")
    expect(Config.getExternalDirectoryWriteForPath("ask", "/any/path")).toBe("ask")
  })

  test("returns undefined when permission is undefined", () => {
    expect(Config.getExternalDirectoryWriteForPath(undefined, "/any/path")).toBeUndefined()
  })

  test("returns permission from pattern map when path matches", () => {
    const permission = {
      write: {
        "/tmp/**": "allow" as const,
        "*": "deny" as const,
      },
    }
    expect(Config.getExternalDirectoryWriteForPath(permission, "/tmp/file.txt")).toBe("allow")
    expect(Config.getExternalDirectoryWriteForPath(permission, "/tmp/subdir/file")).toBe("allow")
    expect(Config.getExternalDirectoryWriteForPath(permission, "/other/path")).toBe("deny")
  })

  test("expands ~ to home directory in patterns", () => {
    const homeDir = os.homedir()
    const permission = {
      write: {
        "~/temp/**": "allow" as const,
        "*": "deny" as const,
      },
    }
    expect(Config.getExternalDirectoryWriteForPath(permission, `${homeDir}/temp/file.txt`)).toBe("allow")
    expect(Config.getExternalDirectoryWriteForPath(permission, `${homeDir}/other/file.txt`)).toBe("deny")
  })

  test("mixed config: pattern map for write, simple value for read", () => {
    const permission = {
      read: "allow" as const,
      write: {
        "/protected/**": "deny" as const,
        "*": "ask" as const,
      },
    }
    expect(Config.getExternalDirectoryWriteForPath(permission, "/protected/file.txt")).toBe("deny")
    expect(Config.getExternalDirectoryWriteForPath(permission, "/other/file.txt")).toBe("ask")
  })
})
