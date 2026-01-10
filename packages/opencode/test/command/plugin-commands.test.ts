import { test, expect, describe, mock } from "bun:test"
import path from "path"

// === Mocks ===
// Mock BunProc to prevent real package installations
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string) => pkg,
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

// Mock default plugins to prevent loading
const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))

// Import after mocks are set up
const { tmpdir } = await import("../fixture/fixture")
const { Instance } = await import("../../src/project/instance")
const { Command } = await import("../../src/command")
const { Plugin } = await import("../../src/plugin")
const { ToolRegistry } = await import("../../src/tool/registry")

describe("Plugin Commands (experimental.pluginCommands)", () => {
  describe("Command.list()", () => {
    test("includes plugin tools with command: true when experimental flag enabled", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create config with experimental flag enabled
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                pluginCommands: true,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Mock Plugin.list() to return a plugin with command: true
          const originalList = Plugin.list
          Plugin.list = async () => [
            {
              tool: {
                "test-command": {
                  description: "A test command",
                  args: {},
                  execute: async () => "test result",
                  command: true,
                  directExecution: true,
                },
              },
            },
          ]

          try {
            const commands = await Command.list()
            const cmd = commands.find((c) => c.name === "plugin:test-command")

            expect(cmd).toBeDefined()
            expect(cmd?.description).toBe("A test command")
            expect(cmd?.pluginCommand).toBe(true)
            expect(cmd?.directExecution).toBe(true)
          } finally {
            Plugin.list = originalList
          }
        },
      })
    })

    test("uses plugin: prefix for plugin command names", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: { pluginCommands: true },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalList = Plugin.list
          Plugin.list = async () => [
            {
              tool: {
                "my-tool": {
                  description: "Tool with prefix",
                  args: {},
                  execute: async () => "result",
                  command: true,
                },
              },
            },
          ]

          try {
            const commands = await Command.list()

            // Should have plugin: prefix
            const withPrefix = commands.find((c) => c.name === "plugin:my-tool")
            expect(withPrefix).toBeDefined()

            // Should NOT have the tool without prefix
            const withoutPrefix = commands.find((c) => c.name === "my-tool")
            expect(withoutPrefix).toBeUndefined()
          } finally {
            Plugin.list = originalList
          }
        },
      })
    })

    test("excludes plugin commands when experimental flag disabled", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Config WITHOUT experimental.pluginCommands
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalList = Plugin.list
          Plugin.list = async () => [
            {
              tool: {
                "hidden-command": {
                  description: "Should not appear",
                  args: {},
                  execute: async () => "result",
                  command: true,
                },
              },
            },
          ]

          try {
            const commands = await Command.list()

            // Should NOT include plugin command when flag is disabled
            const cmd = commands.find((c) => c.name === "plugin:hidden-command")
            expect(cmd).toBeUndefined()
          } finally {
            Plugin.list = originalList
          }
        },
      })
    })

    test("excludes plugin tools without command property", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: { pluginCommands: true },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalList = Plugin.list
          Plugin.list = async () => [
            {
              tool: {
                "tool-only": {
                  description: "Tool without command property",
                  args: {},
                  execute: async () => "result",
                  // No command: true property
                },
              },
            },
          ]

          try {
            const commands = await Command.list()

            // Should NOT include tool without command: true
            const cmd = commands.find((c) => c.name === "plugin:tool-only")
            expect(cmd).toBeUndefined()
          } finally {
            Plugin.list = originalList
          }
        },
      })
    })
  })

  describe("Direct Execution", () => {
    test("command with directExecution: true has execute function", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: { pluginCommands: true },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalList = Plugin.list
          Plugin.list = async () => [
            {
              tool: {
                "direct-tool": {
                  description: "Direct execution tool",
                  args: {},
                  execute: async () => "direct result",
                  command: true,
                  directExecution: true,
                },
              },
            },
          ]

          try {
            const commands = await Command.list()

            const cmd = commands.find((c) => c.name === "plugin:direct-tool")
            expect(cmd).toBeDefined()
            expect(cmd?.directExecution).toBe(true)
            expect(cmd?.execute).toBeDefined()
            expect(typeof cmd?.execute).toBe("function")
          } finally {
            Plugin.list = originalList
          }
        },
      })
    })

    test("command with directExecution: false does not have directExecution flag set to true", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: { pluginCommands: true },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalList = Plugin.list
          Plugin.list = async () => [
            {
              tool: {
                "ai-tool": {
                  description: "AI execution tool",
                  args: {},
                  execute: async () => "ai result",
                  command: true,
                  directExecution: false,
                },
              },
            },
          ]

          try {
            const commands = await Command.list()

            const cmd = commands.find((c) => c.name === "plugin:ai-tool")
            expect(cmd).toBeDefined()
            expect(cmd?.directExecution).toBe(false)
          } finally {
            Plugin.list = originalList
          }
        },
      })
    })
  })

  describe("Backwards Compatibility", () => {
    test("plugins without command property still work as tools in registry", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: { pluginCommands: true },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalList = Plugin.list
          Plugin.list = async () => [
            {
              tool: {
                "legacy-tool": {
                  description: "Legacy tool without command property",
                  args: {},
                  execute: async () => "legacy result",
                },
              },
            },
          ]

          try {
            // Initialize tool registry
            await ToolRegistry.state()

            // Tool should be registered in ToolRegistry
            const registryState = await ToolRegistry.state()
            const legacyTool = registryState.custom.find((t) => t.id === "legacy-tool")
            expect(legacyTool).toBeDefined()
          } finally {
            Plugin.list = originalList
          }
        },
      })
    })

    test("plugin tools are still registered in ToolRegistry even with command: true", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: { pluginCommands: true },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const originalList = Plugin.list
          Plugin.list = async () => [
            {
              tool: {
                "dual-tool": {
                  description: "Tool that is both command and tool",
                  args: {},
                  execute: async () => "dual result",
                  command: true,
                  directExecution: true,
                },
              },
            },
          ]

          try {
            await ToolRegistry.state()

            // Should be in ToolRegistry
            const registryState = await ToolRegistry.state()
            const dualTool = registryState.custom.find((t) => t.id === "dual-tool")
            expect(dualTool).toBeDefined()

            // Should also be in Command.list()
            const commands = await Command.list()
            const cmd = commands.find((c) => c.name === "plugin:dual-tool")
            expect(cmd).toBeDefined()
          } finally {
            Plugin.list = originalList
          }
        },
      })
    })
  })
})
