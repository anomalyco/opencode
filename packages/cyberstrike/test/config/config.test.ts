import { test, expect, describe, mock, afterEach } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { Global } from "../../src/global"

// Get managed config directory from environment (set in preload.ts)
const managedConfigDir = process.env.CYBERSTRIKE_TEST_MANAGED_CONFIG_DIR!

afterEach(async () => {
  await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
})

async function writeManagedSettings(settings: object, filename = "cyberstrike.json") {
  await fs.mkdir(managedConfigDir, { recursive: true })
  await Bun.write(path.join(managedConfigDir, filename), JSON.stringify(settings))
}

async function writeConfig(dir: string, config: object, name = "cyberstrike.json") {
  await Bun.write(path.join(dir, name), JSON.stringify(config))
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
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        model: "test/model",
        username: "testuser",
      })
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
        path.join(dir, "cyberstrike.jsonc"),
        `{
        // This is a comment
        "$schema": "https://cyberstrike.io/config.json",
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
      await writeConfig(
        dir,
        {
          $schema: "https://cyberstrike.io/config.json",
          model: "base",
          username: "base",
        },
        "cyberstrike.jsonc",
      )
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        model: "override",
      })
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
        await writeConfig(dir, {
          $schema: "https://cyberstrike.io/config.json",
          theme: "{env:TEST_VAR}",
        })
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

test("preserves env variables when adding $schema to config", async () => {
  const originalEnv = process.env["PRESERVE_VAR"]
  process.env["PRESERVE_VAR"] = "secret_value"

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Config without $schema - should trigger auto-add
        await Bun.write(
          path.join(dir, "cyberstrike.json"),
          JSON.stringify({
            theme: "{env:PRESERVE_VAR}",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.theme).toBe("secret_value")

        // Read the file to verify the env variable was preserved
        const content = await Bun.file(path.join(tmp.path, "cyberstrike.json")).text()
        expect(content).toContain("{env:PRESERVE_VAR}")
        expect(content).not.toContain("secret_value")
        expect(content).toContain("$schema")
      },
    })
  } finally {
    if (originalEnv !== undefined) {
      process.env["PRESERVE_VAR"] = originalEnv
    } else {
      delete process.env["PRESERVE_VAR"]
    }
  }
})

test("handles file inclusion substitution", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "included.txt"), "test_theme")
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        theme: "{file:included.txt}",
      })
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

test("handles file inclusion with replacement tokens", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "included.md"), "const out = await Bun.$`echo hi`")
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        theme: "{file:included.md}",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.theme).toBe("const out = await Bun.$`echo hi`")
    },
  })
})

test("validates config schema and throws on invalid fields", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        invalid_field: "should cause error",
      })
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
      await Bun.write(path.join(dir, "cyberstrike.json"), "{ invalid json }")
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
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        agent: {
          test_agent: {
            model: "test/model",
            temperature: 0.7,
            description: "test agent",
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["test_agent"]).toEqual(
        expect.objectContaining({
          model: "test/model",
          temperature: 0.7,
          description: "test agent",
        }),
      )
    },
  })
})

test("treats agent variant as model-scoped setting (not provider option)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        agent: {
          test_agent: {
            model: "openai/gpt-5.2",
            variant: "xhigh",
            max_tokens: 123,
          },
        },
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const agent = config.agent?.["test_agent"]

      expect(agent?.variant).toBe("xhigh")
      expect(agent?.options).toMatchObject({
        max_tokens: 123,
      })
      expect(agent?.options).not.toHaveProperty("variant")
    },
  })
})

test("handles command configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        command: {
          test_command: {
            template: "test template",
            description: "test command",
            agent: "test_agent",
          },
        },
      })
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
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
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
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
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
        options: {},
        permission: {},
      })
    },
  })
})

test("loads config from .cyberstrike directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const cyberstrikeDir = path.join(dir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })
      const agentDir = path.join(cyberstrikeDir, "agent")
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
      expect(config.agent?.["test"]).toEqual(
        expect.objectContaining({
          name: "test",
          model: "test/model",
          prompt: "Test agent prompt",
        }),
      )
    },
  })
})

test("loads agents from .cyberstrike/agents (plural)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const cyberstrikeDir = path.join(dir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })

      const agentsDir = path.join(cyberstrikeDir, "agents")
      await fs.mkdir(path.join(agentsDir, "nested"), { recursive: true })

      await Bun.write(
        path.join(agentsDir, "helper.md"),
        `---
model: test/model
mode: subagent
---
Helper agent prompt`,
      )

      await Bun.write(
        path.join(agentsDir, "nested", "child.md"),
        `---
model: test/model
mode: subagent
---
Nested agent prompt`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()

      expect(config.agent?.["helper"]).toMatchObject({
        name: "helper",
        model: "test/model",
        mode: "subagent",
        prompt: "Helper agent prompt",
      })

      expect(config.agent?.["nested/child"]).toMatchObject({
        name: "nested/child",
        model: "test/model",
        mode: "subagent",
        prompt: "Nested agent prompt",
      })
    },
  })
})

test("loads commands from .cyberstrike/command (singular)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const cyberstrikeDir = path.join(dir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })

      const commandDir = path.join(cyberstrikeDir, "command")
      await fs.mkdir(path.join(commandDir, "nested"), { recursive: true })

      await Bun.write(
        path.join(commandDir, "hello.md"),
        `---
description: Test command
---
Hello from singular command`,
      )

      await Bun.write(
        path.join(commandDir, "nested", "child.md"),
        `---
description: Nested command
---
Nested command template`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()

      expect(config.command?.["hello"]).toEqual({
        description: "Test command",
        template: "Hello from singular command",
      })

      expect(config.command?.["nested/child"]).toEqual({
        description: "Nested command",
        template: "Nested command template",
      })
    },
  })
})

test("loads commands from .cyberstrike/commands (plural)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const cyberstrikeDir = path.join(dir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })

      const commandsDir = path.join(cyberstrikeDir, "commands")
      await fs.mkdir(path.join(commandsDir, "nested"), { recursive: true })

      await Bun.write(
        path.join(commandsDir, "hello.md"),
        `---
description: Test command
---
Hello from plural commands`,
      )

      await Bun.write(
        path.join(commandsDir, "nested", "child.md"),
        `---
description: Nested command
---
Nested command template`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()

      expect(config.command?.["hello"]).toEqual({
        description: "Test command",
        template: "Hello from plural commands",
      })

      expect(config.command?.["nested/child"]).toEqual({
        description: "Nested command",
        template: "Nested command template",
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

test("does not try to install dependencies in read-only CYBERSTRIKE_CONFIG_DIR", async () => {
  if (process.platform === "win32") return

  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const ro = path.join(dir, "readonly")
      await fs.mkdir(ro, { recursive: true })
      await fs.chmod(ro, 0o555)
      return ro
    },
    dispose: async (dir) => {
      const ro = path.join(dir, "readonly")
      await fs.chmod(ro, 0o755).catch(() => {})
      return ro
    },
  })

  const prev = process.env.CYBERSTRIKE_CONFIG_DIR
  process.env.CYBERSTRIKE_CONFIG_DIR = tmp.extra

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
      },
    })
  } finally {
    if (prev === undefined) delete process.env.CYBERSTRIKE_CONFIG_DIR
    else process.env.CYBERSTRIKE_CONFIG_DIR = prev
  }
})

test("installs dependencies in writable CYBERSTRIKE_CONFIG_DIR", async () => {
  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const cfg = path.join(dir, "configdir")
      await fs.mkdir(cfg, { recursive: true })
      return cfg
    },
  })

  const prev = process.env.CYBERSTRIKE_CONFIG_DIR
  process.env.CYBERSTRIKE_CONFIG_DIR = tmp.extra

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        await Config.waitForDependencies()
      },
    })

    expect(await Bun.file(path.join(tmp.extra, "package.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(tmp.extra, ".gitignore")).exists()).toBe(true)
  } finally {
    if (prev === undefined) delete process.env.CYBERSTRIKE_CONFIG_DIR
    else process.env.CYBERSTRIKE_CONFIG_DIR = prev
  }
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
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({ $schema: "https://cyberstrike.io/config.json", plugin: ["@scope/plugin"] }, null, 2),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const pluginEntries = config.plugin ?? []

      const baseUrl = pathToFileURL(path.join(tmp.path, "cyberstrike.json")).href
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
      // Create a nested project structure with local .cyberstrike config
      const projectDir = path.join(dir, "project")
      const cyberstrikeDir = path.join(projectDir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })

      // Global config with plugins
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          plugin: ["global-plugin-1", "global-plugin-2"],
        }),
      )

      // Local .cyberstrike config with different plugins
      await Bun.write(
        path.join(cyberstrikeDir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
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

test("does not error when only custom agent is a subagent", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const cyberstrikeDir = path.join(dir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })
      const agentDir = path.join(cyberstrikeDir, "agent")
      await fs.mkdir(agentDir, { recursive: true })

      await Bun.write(
        path.join(agentDir, "helper.md"),
        `---
model: test/model
mode: subagent
---
Helper subagent prompt`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["helper"]).toMatchObject({
        name: "helper",
        model: "test/model",
        mode: "subagent",
        prompt: "Helper subagent prompt",
      })
    },
  })
})

test("merges instructions arrays from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const projectDir = path.join(dir, "project")
      const cyberstrikeDir = path.join(projectDir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })

      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          instructions: ["global-instructions.md", "shared-rules.md"],
        }),
      )

      await Bun.write(
        path.join(cyberstrikeDir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          instructions: ["local-instructions.md"],
        }),
      )
    },
  })

  await Instance.provide({
    directory: path.join(tmp.path, "project"),
    fn: async () => {
      const config = await Config.get()
      const instructions = config.instructions ?? []

      expect(instructions).toContain("global-instructions.md")
      expect(instructions).toContain("shared-rules.md")
      expect(instructions).toContain("local-instructions.md")
      expect(instructions.length).toBe(3)
    },
  })
})

test("deduplicates duplicate instructions from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const projectDir = path.join(dir, "project")
      const cyberstrikeDir = path.join(projectDir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })

      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          instructions: ["duplicate.md", "global-only.md"],
        }),
      )

      await Bun.write(
        path.join(cyberstrikeDir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          instructions: ["duplicate.md", "local-only.md"],
        }),
      )
    },
  })

  await Instance.provide({
    directory: path.join(tmp.path, "project"),
    fn: async () => {
      const config = await Config.get()
      const instructions = config.instructions ?? []

      expect(instructions).toContain("global-only.md")
      expect(instructions).toContain("local-only.md")
      expect(instructions).toContain("duplicate.md")

      const duplicates = instructions.filter((i) => i === "duplicate.md")
      expect(duplicates.length).toBe(1)
      expect(instructions.length).toBe(3)
    },
  })
})

test("deduplicates duplicate plugins from global and local configs", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a nested project structure with local .cyberstrike config
      const projectDir = path.join(dir, "project")
      const cyberstrikeDir = path.join(projectDir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })

      // Global config with plugins
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          plugin: ["duplicate-plugin", "global-plugin-1"],
        }),
      )

      // Local .cyberstrike config with some overlapping plugins
      await Bun.write(
        path.join(cyberstrikeDir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
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

// Legacy tools migration tests

test("migrates legacy tools config to permissions - allow", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          agent: {
            test: {
              tools: {
                bash: true,
                read: true,
              },
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
      expect(config.agent?.["test"]?.permission).toEqual({
        bash: "allow",
        read: "allow",
      })
    },
  })
})

test("migrates legacy tools config to permissions - deny", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          agent: {
            test: {
              tools: {
                bash: false,
                webfetch: false,
              },
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
      expect(config.agent?.["test"]?.permission).toEqual({
        bash: "deny",
        webfetch: "deny",
      })
    },
  })
})

test("migrates legacy write tool to edit permission", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          agent: {
            test: {
              tools: {
                write: true,
              },
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
      expect(config.agent?.["test"]?.permission).toEqual({
        edit: "allow",
      })
    },
  })
})

// Managed settings tests
// Note: preload.ts sets CYBERSTRIKE_TEST_MANAGED_CONFIG which Global.Path.managedConfig uses

test("managed settings override user settings", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        model: "user/model",
        share: "auto",
        username: "testuser",
      })
    },
  })

  await writeManagedSettings({
    $schema: "https://cyberstrike.io/config.json",
    model: "managed/model",
    share: "disabled",
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("managed/model")
      expect(config.share).toBe("disabled")
      expect(config.username).toBe("testuser")
    },
  })
})

test("managed settings override project settings", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        autoupdate: true,
        disabled_providers: [],
        theme: "dark",
      })
    },
  })

  await writeManagedSettings({
    $schema: "https://cyberstrike.io/config.json",
    autoupdate: false,
    disabled_providers: ["openai"],
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.autoupdate).toBe(false)
      expect(config.disabled_providers).toEqual(["openai"])
      expect(config.theme).toBe("dark")
    },
  })
})

test("missing managed settings file is not an error", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://cyberstrike.io/config.json",
        model: "user/model",
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("user/model")
    },
  })
})

test("migrates legacy edit tool to edit permission", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          agent: {
            test: {
              tools: {
                edit: false,
              },
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
      expect(config.agent?.["test"]?.permission).toEqual({
        edit: "deny",
      })
    },
  })
})

test("migrates legacy patch tool to edit permission", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          agent: {
            test: {
              tools: {
                patch: true,
              },
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
      expect(config.agent?.["test"]?.permission).toEqual({
        edit: "allow",
      })
    },
  })
})

test("migrates legacy multiedit tool to edit permission", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          agent: {
            test: {
              tools: {
                multiedit: false,
              },
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
      expect(config.agent?.["test"]?.permission).toEqual({
        edit: "deny",
      })
    },
  })
})

test("migrates mixed legacy tools config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          agent: {
            test: {
              tools: {
                bash: true,
                write: true,
                read: false,
                webfetch: true,
              },
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
      expect(config.agent?.["test"]?.permission).toEqual({
        bash: "allow",
        edit: "allow",
        read: "deny",
        webfetch: "allow",
      })
    },
  })
})

test("merges legacy tools with existing permission config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          agent: {
            test: {
              permission: {
                glob: "allow",
              },
              tools: {
                bash: true,
              },
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
      expect(config.agent?.["test"]?.permission).toEqual({
        glob: "allow",
        bash: "allow",
      })
    },
  })
})

test("permission config preserves key order", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          permission: {
            "*": "deny",
            edit: "ask",
            write: "ask",
            external_directory: "ask",
            read: "allow",
            todowrite: "allow",
            todoread: "allow",
            "thoughts_*": "allow",
            "reasoning_model_*": "allow",
            "tools_*": "allow",
            "pr_comments_*": "allow",
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(Object.keys(config.permission!)).toEqual([
        "*",
        "edit",
        "write",
        "external_directory",
        "read",
        "todowrite",
        "todoread",
        "thoughts_*",
        "reasoning_model_*",
        "tools_*",
        "pr_comments_*",
      ])
    },
  })
})

// MCP config merging tests

test("project config can override MCP server enabled status", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Simulates a base config (like from remote .well-known) with disabled MCP
      await Bun.write(
        path.join(dir, "cyberstrike.jsonc"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          mcp: {
            jira: {
              type: "remote",
              url: "https://jira.example.com/mcp",
              enabled: false,
            },
            wiki: {
              type: "remote",
              url: "https://wiki.example.com/mcp",
              enabled: false,
            },
          },
        }),
      )
      // Project config enables just jira
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          mcp: {
            jira: {
              type: "remote",
              url: "https://jira.example.com/mcp",
              enabled: true,
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
      // jira should be enabled (overridden by project config)
      expect(config.mcp?.jira).toEqual({
        type: "remote",
        url: "https://jira.example.com/mcp",
        enabled: true,
      })
      // wiki should still be disabled (not overridden)
      expect(config.mcp?.wiki).toEqual({
        type: "remote",
        url: "https://wiki.example.com/mcp",
        enabled: false,
      })
    },
  })
})

test("MCP config deep merges preserving base config properties", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Base config with full MCP definition
      await Bun.write(
        path.join(dir, "cyberstrike.jsonc"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          mcp: {
            myserver: {
              type: "remote",
              url: "https://myserver.example.com/mcp",
              enabled: false,
              headers: {
                "X-Custom-Header": "value",
              },
            },
          },
        }),
      )
      // Override just enables it, should preserve other properties
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          mcp: {
            myserver: {
              type: "remote",
              url: "https://myserver.example.com/mcp",
              enabled: true,
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
      expect(config.mcp?.myserver).toEqual({
        type: "remote",
        url: "https://myserver.example.com/mcp",
        enabled: true,
        headers: {
          "X-Custom-Header": "value",
        },
      })
    },
  })
})

test("local .cyberstrike config can override MCP from project config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Project config with disabled MCP
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          mcp: {
            docs: {
              type: "remote",
              url: "https://docs.example.com/mcp",
              enabled: false,
            },
          },
        }),
      )
      // Local .cyberstrike directory config enables it
      const cyberstrikeDir = path.join(dir, ".cyberstrike")
      await fs.mkdir(cyberstrikeDir, { recursive: true })
      await Bun.write(
        path.join(cyberstrikeDir, "cyberstrike.json"),
        JSON.stringify({
          $schema: "https://cyberstrike.io/config.json",
          mcp: {
            docs: {
              type: "remote",
              url: "https://docs.example.com/mcp",
              enabled: true,
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
      expect(config.mcp?.docs?.enabled).toBe(true)
    },
  })
})

test("project config overrides remote well-known config", async () => {
  const originalFetch = globalThis.fetch
  let fetchedUrl: string | undefined
  const mockFetch = mock((url: string | URL | Request) => {
    const urlStr = url.toString()
    if (urlStr.includes(".well-known/cyberstrike")) {
      fetchedUrl = urlStr
      return Promise.resolve(
        new Response(
          JSON.stringify({
            config: {
              mcp: {
                jira: {
                  type: "remote",
                  url: "https://jira.example.com/mcp",
                  enabled: false,
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
    }
    return originalFetch(url)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const originalAuthAll = Auth.all
  Auth.all = mock(() =>
    Promise.resolve({
      "https://example.com": {
        type: "wellknown" as const,
        key: "TEST_TOKEN",
        token: "test-token",
      },
    }),
  )

  try {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Project config enables jira (overriding remote default)
        await Bun.write(
          path.join(dir, "cyberstrike.json"),
          JSON.stringify({
            $schema: "https://cyberstrike.io/config.json",
            mcp: {
              jira: {
                type: "remote",
                url: "https://jira.example.com/mcp",
                enabled: true,
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
        // Verify fetch was called for wellknown config
        expect(fetchedUrl).toBe("https://example.com/.well-known/cyberstrike")
        // Project config (enabled: true) should override remote (enabled: false)
        expect(config.mcp?.jira?.enabled).toBe(true)
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    Auth.all = originalAuthAll
  }
})

describe("getPluginName", () => {
  test("extracts name from file:// URL", () => {
    expect(Config.getPluginName("file:///path/to/plugin/foo.js")).toBe("foo")
    expect(Config.getPluginName("file:///path/to/plugin/bar.ts")).toBe("bar")
    expect(Config.getPluginName("file:///some/path/my-plugin.js")).toBe("my-plugin")
  })

  test("extracts name from npm package with version", () => {
    expect(Config.getPluginName("oh-my-cyberstrike@2.4.3")).toBe("oh-my-cyberstrike")
    expect(Config.getPluginName("some-plugin@1.0.0")).toBe("some-plugin")
    expect(Config.getPluginName("plugin@latest")).toBe("plugin")
  })

  test("extracts name from scoped npm package", () => {
    expect(Config.getPluginName("@scope/pkg@1.0.0")).toBe("@scope/pkg")
    expect(Config.getPluginName("@cyberstrike/plugin@2.0.0")).toBe("@cyberstrike/plugin")
  })

  test("returns full string for package without version", () => {
    expect(Config.getPluginName("some-plugin")).toBe("some-plugin")
    expect(Config.getPluginName("@scope/pkg")).toBe("@scope/pkg")
  })
})

describe("deduplicatePlugins", () => {
  test("removes duplicates keeping higher priority (later entries)", () => {
    const plugins = ["global-plugin@1.0.0", "shared-plugin@1.0.0", "local-plugin@2.0.0", "shared-plugin@2.0.0"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result).toContain("global-plugin@1.0.0")
    expect(result).toContain("local-plugin@2.0.0")
    expect(result).toContain("shared-plugin@2.0.0")
    expect(result).not.toContain("shared-plugin@1.0.0")
    expect(result.length).toBe(3)
  })

  test("prefers local file over npm package with same name", () => {
    const plugins = ["oh-my-cyberstrike@2.4.3", "file:///project/.cyberstrike/plugin/oh-my-cyberstrike.js"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result.length).toBe(1)
    expect(result[0]).toBe("file:///project/.cyberstrike/plugin/oh-my-cyberstrike.js")
  })

  test("preserves order of remaining plugins", () => {
    const plugins = ["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result).toEqual(["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"])
  })

  test("local plugin directory overrides global cyberstrike.json plugin", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const projectDir = path.join(dir, "project")
        const cyberstrikeDir = path.join(projectDir, ".cyberstrike")
        const pluginDir = path.join(cyberstrikeDir, "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(dir, "cyberstrike.json"),
          JSON.stringify({
            $schema: "https://cyberstrike.io/config.json",
            plugin: ["my-plugin@1.0.0"],
          }),
        )

        await Bun.write(path.join(pluginDir, "my-plugin.js"), "export default {}")
      },
    })

    await Instance.provide({
      directory: path.join(tmp.path, "project"),
      fn: async () => {
        const config = await Config.get()
        const plugins = config.plugin ?? []

        const myPlugins = plugins.filter((p) => Config.getPluginName(p) === "my-plugin")
        expect(myPlugins.length).toBe(1)
        expect(myPlugins[0].startsWith("file://")).toBe(true)
      },
    })
  })
})

describe("CYBERSTRIKE_DISABLE_PROJECT_CONFIG", () => {
  test("skips project config files when flag is set", async () => {
    const originalEnv = process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
    process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = "true"

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a project config that would normally be loaded
          await Bun.write(
            path.join(dir, "cyberstrike.json"),
            JSON.stringify({
              $schema: "https://cyberstrike.io/config.json",
              model: "project/model",
              username: "project-user",
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          // Project config should NOT be loaded - model should be default, not "project/model"
          expect(config.model).not.toBe("project/model")
          expect(config.username).not.toBe("project-user")
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = originalEnv
      }
    }
  })

  test("skips project .cyberstrike/ directories when flag is set", async () => {
    const originalEnv = process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
    process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = "true"

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a .cyberstrike directory with a command
          const cyberstrikeDir = path.join(dir, ".cyberstrike", "command")
          await fs.mkdir(cyberstrikeDir, { recursive: true })
          await Bun.write(path.join(cyberstrikeDir, "test-cmd.md"), "# Test Command\nThis is a test command.")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const directories = await Config.directories()
          // Project .cyberstrike should NOT be in directories list
          const hasProjectCyberstrike = directories.some((d) => d.startsWith(tmp.path))
          expect(hasProjectCyberstrike).toBe(false)
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = originalEnv
      }
    }
  })

  test("still loads global config when flag is set", async () => {
    const originalEnv = process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
    process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = "true"

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Should still get default config (from global or defaults)
          const config = await Config.get()
          expect(config).toBeDefined()
          expect(config.username).toBeDefined()
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = originalEnv
      }
    }
  })

  test("skips relative instructions with warning when flag is set but no config dir", async () => {
    const originalDisable = process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
    const originalConfigDir = process.env["CYBERSTRIKE_CONFIG_DIR"]

    try {
      // Ensure no config dir is set
      delete process.env["CYBERSTRIKE_CONFIG_DIR"]
      process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = "true"

      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a config with relative instruction path
          await Bun.write(
            path.join(dir, "cyberstrike.json"),
            JSON.stringify({
              $schema: "https://cyberstrike.io/config.json",
              instructions: ["./CUSTOM.md"],
            }),
          )
          // Create the instruction file (should be skipped)
          await Bun.write(path.join(dir, "CUSTOM.md"), "# Custom Instructions")
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // The relative instruction should be skipped without error
          // We're mainly verifying this doesn't throw and the config loads
          const config = await Config.get()
          expect(config).toBeDefined()
          // The instruction should have been skipped (warning logged)
          // We can't easily test the warning was logged, but we verify
          // the relative path didn't cause an error
        },
      })
    } finally {
      if (originalDisable === undefined) {
        delete process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = originalDisable
      }
      if (originalConfigDir === undefined) {
        delete process.env["CYBERSTRIKE_CONFIG_DIR"]
      } else {
        process.env["CYBERSTRIKE_CONFIG_DIR"] = originalConfigDir
      }
    }
  })

  test("CYBERSTRIKE_CONFIG_DIR still works when flag is set", async () => {
    const originalDisable = process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
    const originalConfigDir = process.env["CYBERSTRIKE_CONFIG_DIR"]

    try {
      await using configDirTmp = await tmpdir({
        init: async (dir) => {
          // Create config in the custom config dir
          await Bun.write(
            path.join(dir, "cyberstrike.json"),
            JSON.stringify({
              $schema: "https://cyberstrike.io/config.json",
              model: "configdir/model",
            }),
          )
        },
      })

      await using projectTmp = await tmpdir({
        init: async (dir) => {
          // Create config in project (should be ignored)
          await Bun.write(
            path.join(dir, "cyberstrike.json"),
            JSON.stringify({
              $schema: "https://cyberstrike.io/config.json",
              model: "project/model",
            }),
          )
        },
      })

      process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = "true"
      process.env["CYBERSTRIKE_CONFIG_DIR"] = configDirTmp.path

      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const config = await Config.get()
          // Should load from CYBERSTRIKE_CONFIG_DIR, not project
          expect(config.model).toBe("configdir/model")
        },
      })
    } finally {
      if (originalDisable === undefined) {
        delete process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"]
      } else {
        process.env["CYBERSTRIKE_DISABLE_PROJECT_CONFIG"] = originalDisable
      }
      if (originalConfigDir === undefined) {
        delete process.env["CYBERSTRIKE_CONFIG_DIR"]
      } else {
        process.env["CYBERSTRIKE_CONFIG_DIR"] = originalConfigDir
      }
    }
  })
})
