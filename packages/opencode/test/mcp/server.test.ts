import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Wildcard } from "../../src/util/wildcard"
import { Instance } from "../../src/project/instance"

// Path to the opencode package's node_modules (for symlinking into temp dirs)
const opencodePackageRoot = path.resolve(__dirname, "../..")
const nodeModulesPath = path.join(opencodePackageRoot, "node_modules")

// =============================================================================
// Unit Tests: Wildcard filtering behavior
// =============================================================================
// These tests verify the filtering semantics used by McpServer for tool gating.
// The actual filtering in server.ts uses Wildcard.all() which is tested here.
// =============================================================================

describe("mcp server wildcard filtering", () => {
  test("empty config enables all tools", () => {
    const toolsConfig: Record<string, boolean> = {}
    // When tools config is empty, all tools should be enabled
    // The server.ts logic checks: Object.keys(toolsConfig).length === 0 ? true : ...
    const isEnabled = Object.keys(toolsConfig).length === 0 ? true : Wildcard.all("any-tool", toolsConfig) !== false
    expect(isEnabled).toBe(true)
  })

  test("omitted tools config enables all tools", () => {
    const toolsConfig = undefined
    // When tools config is omitted (undefined), all tools should be enabled
    const resolvedConfig = toolsConfig ?? {}
    const isEnabled =
      Object.keys(resolvedConfig).length === 0 ? true : Wildcard.all("any-tool", resolvedConfig) !== false
    expect(isEnabled).toBe(true)
  })

  test('{ "*": false, "echo": true } enables only echo', () => {
    const toolsConfig = { "*": false, echo: true }

    // echo should be enabled
    const echoEnabled = Wildcard.all("echo", toolsConfig) !== false
    expect(echoEnabled).toBe(true)

    // other tools should be disabled
    const otherEnabled = Wildcard.all("other-tool", toolsConfig) !== false
    expect(otherEnabled).toBe(false)

    const dangerEnabled = Wildcard.all("danger", toolsConfig) !== false
    expect(dangerEnabled).toBe(false)
  })

  test('{ "*": true, "danger": false } enables all except danger', () => {
    const toolsConfig = { "*": true, danger: false }

    // echo should be enabled
    const echoEnabled = Wildcard.all("echo", toolsConfig) !== false
    expect(echoEnabled).toBe(true)

    // foo should be enabled
    const fooEnabled = Wildcard.all("foo", toolsConfig) !== false
    expect(fooEnabled).toBe(true)

    // danger should be disabled
    const dangerEnabled = Wildcard.all("danger", toolsConfig) !== false
    expect(dangerEnabled).toBe(false)
  })

  test('{ "*": false } disables all tools', () => {
    const toolsConfig = { "*": false }

    const echoEnabled = Wildcard.all("echo", toolsConfig) !== false
    expect(echoEnabled).toBe(false)

    const anyToolEnabled = Wildcard.all("any-tool", toolsConfig) !== false
    expect(anyToolEnabled).toBe(false)
  })

  test('{ "*": true } enables all tools', () => {
    const toolsConfig = { "*": true }

    const echoEnabled = Wildcard.all("echo", toolsConfig) !== false
    expect(echoEnabled).toBe(true)

    const anyToolEnabled = Wildcard.all("any-tool", toolsConfig) !== false
    expect(anyToolEnabled).toBe(true)
  })

  test("pattern matching with prefix wildcards", () => {
    const toolsConfig = { "*": false, "test_*": true }

    // test_foo should be enabled
    const testFooEnabled = Wildcard.all("test_foo", toolsConfig) !== false
    expect(testFooEnabled).toBe(true)

    // test_bar should be enabled
    const testBarEnabled = Wildcard.all("test_bar", toolsConfig) !== false
    expect(testBarEnabled).toBe(true)

    // other tools should be disabled
    const otherEnabled = Wildcard.all("other", toolsConfig) !== false
    expect(otherEnabled).toBe(false)
  })

  test("more specific pattern overrides general pattern", () => {
    const toolsConfig = { "*": true, "danger*": false, danger_safe: true }

    // normal tools enabled
    expect(Wildcard.all("echo", toolsConfig) !== false).toBe(true)

    // danger_foo disabled (matches danger*)
    expect(Wildcard.all("danger_foo", toolsConfig) !== false).toBe(false)

    // danger_safe enabled (more specific override)
    expect(Wildcard.all("danger_safe", toolsConfig) !== false).toBe(true)
  })
})

// =============================================================================
// Integration Tests: McpServer.listTools()
// =============================================================================
// These tests verify that McpServer.listTools() correctly filters tools
// based on config and returns proper tool info.
// =============================================================================

describe("mcp server listTools", () => {
  test("returns custom tools when mcpServer.enabled is true", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Symlink node_modules so tool files can import zod
        await fs.symlink(nodeModulesPath, path.join(dir, "node_modules"), "dir")

        // Create .opencode/tool directory structure
        const toolDir = path.join(dir, ".opencode", "tool")
        await fs.mkdir(toolDir, { recursive: true })

        // Create a simple echo tool
        await Bun.write(
          path.join(toolDir, "echo.ts"),
          `import z from "zod"

export default {
  description: "Echo the input message",
  args: {
    message: z.string().describe("The message to echo"),
  },
  execute: async ({ message }) => message,
}
`,
        )

        // Create config with mcpServer enabled
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcpServer: {
              enabled: true,
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { McpServer } = await import("../../src/mcp/server")
        const tools = await McpServer.listTools()

        // Should have at least one tool (echo)
        expect(tools.length).toBeGreaterThanOrEqual(1)

        // Find the echo tool
        const echoTool = tools.find((t: { id: string; description: string }) => t.id === "echo")
        expect(echoTool).toBeDefined()
        expect(echoTool?.description).toBe("Echo the input message")
      },
    })
  })

  test('filters tools with { "*": false }', async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Symlink node_modules so tool files can import zod
        await fs.symlink(nodeModulesPath, path.join(dir, "node_modules"), "dir")

        // Create .opencode/tool directory structure
        const toolDir = path.join(dir, ".opencode", "tool")
        await fs.mkdir(toolDir, { recursive: true })

        // Create a simple echo tool
        await Bun.write(
          path.join(toolDir, "echo.ts"),
          `import z from "zod"

export default {
  description: "Echo the input message",
  args: {
    message: z.string().describe("The message to echo"),
  },
  execute: async ({ message }) => message,
}
`,
        )

        // Create config with all tools disabled
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcpServer: {
              enabled: true,
              tools: {
                "*": false,
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { McpServer } = await import("../../src/mcp/server")
        const tools = await McpServer.listTools()

        // Should have no tools when all are disabled
        expect(tools.length).toBe(0)
      },
    })
  })

  test('selective enable with { "*": false, "echo": true }', async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Symlink node_modules so tool files can import zod
        await fs.symlink(nodeModulesPath, path.join(dir, "node_modules"), "dir")

        // Create .opencode/tool directory structure
        const toolDir = path.join(dir, ".opencode", "tool")
        await fs.mkdir(toolDir, { recursive: true })

        // Create echo tool
        await Bun.write(
          path.join(toolDir, "echo.ts"),
          `import z from "zod"

export default {
  description: "Echo the input message",
  args: {
    message: z.string().describe("The message to echo"),
  },
  execute: async ({ message }) => message,
}
`,
        )

        // Create another tool (foo)
        await Bun.write(
          path.join(toolDir, "foo.ts"),
          `import z from "zod"

export default {
  description: "Foo tool",
  args: {
    input: z.string(),
  },
  execute: async ({ input }) => "foo: " + input,
}
`,
        )

        // Create config with only echo enabled
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcpServer: {
              enabled: true,
              tools: {
                "*": false,
                echo: true,
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { McpServer } = await import("../../src/mcp/server")
        const tools = await McpServer.listTools()

        // Should have exactly one tool (echo)
        expect(tools.length).toBe(1)
        expect(tools[0].id).toBe("echo")
      },
    })
  })

  test('selective disable with { "*": true, "danger": false }', async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Symlink node_modules so tool files can import zod
        await fs.symlink(nodeModulesPath, path.join(dir, "node_modules"), "dir")

        // Create .opencode/tool directory structure
        const toolDir = path.join(dir, ".opencode", "tool")
        await fs.mkdir(toolDir, { recursive: true })

        // Create echo tool
        await Bun.write(
          path.join(toolDir, "echo.ts"),
          `import z from "zod"

export default {
  description: "Echo the input message",
  args: {
    message: z.string(),
  },
  execute: async ({ message }) => message,
}
`,
        )

        // Create danger tool
        await Bun.write(
          path.join(toolDir, "danger.ts"),
          `import z from "zod"

export default {
  description: "Dangerous tool",
  args: {
    input: z.string(),
  },
  execute: async ({ input }) => "danger: " + input,
}
`,
        )

        // Create config with danger disabled
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcpServer: {
              enabled: true,
              tools: {
                "*": true,
                danger: false,
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { McpServer } = await import("../../src/mcp/server")
        const tools = await McpServer.listTools()

        // Should have echo but not danger
        const toolIds = tools.map((t: { id: string; description: string }) => t.id)
        expect(toolIds).toContain("echo")
        expect(toolIds).not.toContain("danger")
      },
    })
  })
})

// =============================================================================
// Note: Full MCP subprocess integration tests
// =============================================================================
// Full subprocess-based integration tests (starting `opencode mcp serve` as a
// subprocess and connecting with MCP client SDK) would require additional setup:
//
// 1. Building the opencode CLI or having it available
// 2. Spawning it as a subprocess with stdio pipes
// 3. Using @modelcontextprotocol/sdk/client to connect
// 4. Managing process lifecycle and cleanup
//
// These tests are more complex and may be flaky in CI environments. The unit
// tests above cover the core filtering logic, and the integration tests verify
// that McpServer.listTools() works correctly with real config files.
//
// For manual verification, use:
//   1. Create a project with .opencode/tool/echo.ts and opencode.json config
//   2. Run: opencode mcp serve --list
//   3. Verify the tool list output
// =============================================================================
