import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import {
  McpAddCommand,
  McpRemoveCommand,
  McpListCommand,
  McpGetCommand,
  McpAddJsonCommand,
  McpEnableCommand,
  McpDisableCommand,
} from "../../src/cli/cmd/mcp"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs"

const testConfigDir = path.join(process.cwd(), "test-config")
const testConfigPath = path.join(testConfigDir, "config.json")
const testProjectDir = path.join(process.cwd(), "test-project")
const testProjectConfigPath = path.join(testProjectDir, "opencode.json")

let originalCwd: string
let originalGlobalPath: string
let configGlobalSpy: ReturnType<typeof spyOn> | undefined
let configGetSpy: ReturnType<typeof spyOn> | undefined

// Helper to capture stderr output
function captureStderr() {
  const outputs: string[] = []

  const spy = spyOn(Bun.stderr, "write").mockImplementation(async (data) => {
    if (typeof data === "string") {
      outputs.push(data)
    } else if (data instanceof Uint8Array) {
      outputs.push(new TextDecoder().decode(data))
    } else {
      outputs.push(String(data))
    }
    return typeof data === "string" ? data.length : 0
  })

  return {
    getOutput: () => outputs.join(""),
    restore: () => spy.mockRestore(),
  }
}

beforeEach(async () => {
  // Create test directories
  await fs.promises.mkdir(testConfigDir, { recursive: true })
  await fs.promises.mkdir(testProjectDir, { recursive: true })

  // Store original values
  originalGlobalPath = Global.Path.config
  originalCwd = process.cwd()

  // Mock Global.Path.config to use test directory
  // @ts-expect-error - Mocking for tests
  Global.Path.config = testConfigDir

  // Mock process.cwd to use test project directory
  process.cwd = () => testProjectDir

  // Create empty configs with proper structure
  await Bun.write(testConfigPath, JSON.stringify({}, null, 2))
  await Bun.write(testProjectConfigPath, JSON.stringify({}, null, 2))

  // Spy on Config.global to use test config
  configGlobalSpy = spyOn(Config, "global").mockImplementation(async () => {
    try {
      const file = Bun.file(testConfigPath)
      const data = await file.json()
      return data
    } catch (error) {
      return {}
    }
  })

  // Spy on Config.get to use test configs (merged global + project)
  configGetSpy = spyOn(Config, "get").mockImplementation(async () => {
    const globalConfig = await configGlobalSpy!()
    let projectConfig = {}
    try {
      const file = Bun.file(testProjectConfigPath)
      projectConfig = await file.json()
    } catch (error) {
      // Project config doesn't exist yet
    }
    // Simple merge - project config takes precedence
    return { ...globalConfig, ...projectConfig }
  })
})

afterEach(async () => {
  // Restore original values
  process.cwd = () => originalCwd
  // @ts-expect-error - Restoring mocked value
  Global.Path.config = originalGlobalPath

  // Restore spies
  configGlobalSpy?.mockRestore()
  configGetSpy?.mockRestore()

  // Clean up test directories
  await fs.promises.rm(testConfigDir, { recursive: true, force: true })
  await fs.promises.rm(testProjectDir, { recursive: true, force: true })
})

describe("mcp command", () => {
  test("add local MCP server", async () => {
    const args = {
      name: "test-server",
      commandOrUrl: "node",
      args: ["server.js"],
      scope: "project" as const,
      transport: "stdio" as const,
      env: ["NODE_ENV=test", "PORT=3000"],
      header: [],
      _: [],
      $0: "opencode",
    }

    await McpAddCommand.handler(args)

    // Read project config
    const projectConfig = await Config.get()
    expect(projectConfig.mcp).toBeDefined()
    expect(projectConfig.mcp?.["test-server"]).toMatchObject({
      type: "local",
      command: ["node", "server.js"],
      environment: {
        NODE_ENV: "test",
        PORT: "3000",
      },
    })
  })

  test("add remote MCP server with SSE", async () => {
    const args = {
      name: "remote-server",
      commandOrUrl: "https://example.com/mcp",
      args: [],
      scope: "user" as const,
      transport: "sse" as const,
      env: [],
      header: ["Authorization: Bearer token123"],
      _: [],
      $0: "opencode",
    }

    await McpAddCommand.handler(args)

    const config = await Config.global()
    expect(config.mcp).toBeDefined()
    expect(config.mcp?.["remote-server"]).toMatchObject({
      type: "remote",
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer token123",
      },
    })
  })

  test("add SSE transport server to project scope", async () => {
    const args = {
      name: "sse-server",
      commandOrUrl: "http://localhost:8080/mcp",
      args: [],
      scope: "project" as const,
      transport: "sse" as const,
      env: [],
      header: ["X-API-Key: abc123", "Content-Type: application/json"],
      _: [],
      $0: "opencode",
    }

    await McpAddCommand.handler(args)

    const projectConfig = await Config.get()
    expect(projectConfig.mcp?.["sse-server"]).toMatchObject({
      type: "remote",
      url: "http://localhost:8080/mcp",
      headers: {
        "X-API-Key": "abc123",
        "Content-Type": "application/json",
      },
    })
  })

  test("validate transport constraints", async () => {
    const stderr = captureStderr()

    // Test stdio with URL should fail
    const args = {
      name: "invalid-stdio",
      commandOrUrl: "https://example.com",
      args: [],
      scope: "project" as const,
      transport: "stdio" as const,
      env: [],
      header: [],
      _: [],
      $0: "opencode",
    }

    await McpAddCommand.handler(args)

    expect(stderr.getOutput()).toContain(
      "stdio transport requires a command, not a URL",
    )

    stderr.restore()
  })

  test("add server to user scope", async () => {
    const args = {
      name: "user-server",
      commandOrUrl: "bun",
      args: ["run", "server.ts"],
      scope: "user" as const,
      transport: "stdio" as const,
      env: ["DEBUG=true"],
      header: [],
      _: [],
      $0: "opencode",
    }

    await McpAddCommand.handler(args)

    const config = await Config.global()
    expect(config.mcp).toBeDefined()
    expect(config.mcp?.["user-server"]).toMatchObject({
      type: "local",
      command: ["bun", "run", "server.ts"],
      environment: {
        DEBUG: "true",
      },
    })
  })

  test("remove MCP server from project scope", async () => {
    // First add a server to project config
    await Bun.write(
      testProjectConfigPath,
      JSON.stringify(
        {
          mcp: {
            "test-server": {
              type: "local",
              command: ["node", "server.js"],
            },
          },
        },
        null,
        2,
      ),
    )

    const args = {
      name: "test-server",
      scope: "project" as const,
      _: [],
      $0: "opencode",
    }
    await McpRemoveCommand.handler(args)

    const projectConfig = await Config.get()
    expect(projectConfig.mcp).toBeUndefined()
  })

  test("remove MCP server from user scope", async () => {
    // First add a server to user config
    await Bun.write(
      testConfigPath,
      JSON.stringify(
        {
          mcp: {
            "user-test-server": {
              type: "local",
              command: ["node", "server.js"],
            },
          },
        },
        null,
        2,
      ),
    )

    const args = {
      name: "user-test-server",
      scope: "user" as const,
      _: [],
      $0: "opencode",
    }
    await McpRemoveCommand.handler(args)

    const config = await Config.global()
    expect(config.mcp).toBeUndefined()
  })

  test("remove non-existent MCP server shows error", async () => {
    const stderr = captureStderr()

    const args = {
      name: "non-existent",
      scope: "project" as const,
      _: [],
      $0: "opencode",
    }
    await McpRemoveCommand.handler(args)

    expect(stderr.getOutput()).toContain(
      'MCP server "non-existent" not found in project config',
    )

    stderr.restore()
  })

  test("add server with JSON to project scope", async () => {
    const args = {
      name: "json-server",
      scope: "project" as const,
      json: JSON.stringify({
        type: "local",
        command: ["bun", "run", "mcp-server.ts"],
        environment: { DEBUG: "true" },
      }),
      _: [],
      $0: "opencode",
    }

    await McpAddJsonCommand.handler(args)

    const projectConfig = await Config.get()
    expect(projectConfig.mcp?.["json-server"]).toMatchObject({
      type: "local",
      command: ["bun", "run", "mcp-server.ts"],
      environment: { DEBUG: "true" },
    })
  })

  test("add server with JSON to user scope", async () => {
    const args = {
      name: "user-json-server",
      scope: "user" as const,
      json: JSON.stringify({
        type: "remote",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      }),
      _: [],
      $0: "opencode",
    }

    await McpAddJsonCommand.handler(args)

    const config = await Config.global()
    expect(config.mcp?.["user-json-server"]).toMatchObject({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer token" },
    })
  })

  test("list empty MCP servers", async () => {
    const stderr = captureStderr()

    await McpListCommand.handler({ $0: "opencode", _: [] })

    expect(stderr.getOutput()).toContain("No MCP servers configured")
    stderr.restore()
  })

  test("list global and project MCP servers", async () => {
    // Add a server to user config
    await Bun.write(
      testConfigPath,
      JSON.stringify(
        {
          mcp: {
            "global-server": {
              type: "local",
              command: ["node", "global-server.js"],
            },
          },
        },
        null,
        2,
      ),
    )

    // Add a server to project config
    await Bun.write(
      testProjectConfigPath,
      JSON.stringify(
        {
          mcp: {
            "project-server": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        },
        null,
        2,
      ),
    )

    const stderr = captureStderr()

    await McpListCommand.handler({ $0: "opencode", _: [] })

    const output = stderr.getOutput()
    expect(output).toContain("Global MCP servers:")
    expect(output).toContain("Project MCP servers:")
    expect(output).toContain("global-server")
    expect(output).toContain("project-server")
    stderr.restore()
  })

  test("get MCP server details from user scope", async () => {
    // Add a server to user config
    await Bun.write(
      testConfigPath,
      JSON.stringify(
        {
          mcp: {
            "detail-server": {
              type: "local",
              command: ["node", "server.js"],
              environment: { PORT: "3000" },
            },
          },
        },
        null,
        2,
      ),
    )

    const stderr = captureStderr()

    const args = {
      name: "detail-server",
      _: [],
      $0: "opencode",
    }
    await McpGetCommand.handler(args)

    const output = stderr.getOutput()
    expect(output).toContain("MCP Server: detail-server")
    expect(output).toContain("Scope: user")
    expect(output).toContain("Type: local")
    expect(output).toContain("Enabled: true")
    stderr.restore()
  })

  test("get MCP server details from project scope", async () => {
    // Add a server to project config
    await Bun.write(
      testProjectConfigPath,
      JSON.stringify(
        {
          mcp: {
            "project-server": {
              type: "remote",
              url: "https://example.com/mcp",
              headers: { Authorization: "Bearer token" },
            },
          },
        },
        null,
        2,
      ),
    )

    const stderr = captureStderr()

    const args = {
      name: "project-server",
      _: [],
      $0: "opencode",
    }
    await McpGetCommand.handler(args)

    const output = stderr.getOutput()
    expect(output).toContain("MCP Server: project-server")
    expect(output).toContain("Scope: project")
    expect(output).toContain("Type: remote")
    expect(output).toContain("Enabled: true")
    expect(output).toContain("Headers:")
    stderr.restore()
  })

  test("get MCP server prioritizes project over user scope", async () => {
    // Add server with same name to both configs
    await Bun.write(
      testConfigPath,
      JSON.stringify(
        {
          mcp: {
            "shared-server": {
              type: "local",
              command: ["node", "user-server.js"],
            },
          },
        },
        null,
        2,
      ),
    )

    await Bun.write(
      testProjectConfigPath,
      JSON.stringify(
        {
          mcp: {
            "shared-server": {
              type: "local",
              command: ["node", "project-server.js"],
            },
          },
        },
        null,
        2,
      ),
    )

    const stderr = captureStderr()

    const args = {
      name: "shared-server",
      _: [],
      $0: "opencode",
    }
    await McpGetCommand.handler(args)

    const output = stderr.getOutput()
    expect(output).toContain("Scope: project")
    expect(output).toContain("project-server.js")
    expect(output).not.toContain("user-server.js")
    stderr.restore()
  })

  test("enable MCP server in project scope", async () => {
    // First add a disabled server to project config
    await Bun.write(
      testProjectConfigPath,
      JSON.stringify(
        {
          mcp: {
            "disabled-server": {
              type: "local",
              command: ["node", "server.js"],
              enabled: false,
            },
          },
        },
        null,
        2,
      ),
    )

    const args = {
      name: "disabled-server",
      scope: "project" as const,
      _: [],
      $0: "opencode",
    }
    await McpEnableCommand.handler(args)

    const projectConfig = await Config.get()
    expect(projectConfig.mcp?.["disabled-server"].enabled).toBe(true)
  })

  test("enable MCP server in user scope", async () => {
    // First add a disabled server to user config
    await Bun.write(
      testConfigPath,
      JSON.stringify(
        {
          mcp: {
            "user-disabled-server": {
              type: "remote",
              url: "https://example.com/mcp",
              enabled: false,
            },
          },
        },
        null,
        2,
      ),
    )

    const args = {
      name: "user-disabled-server",
      scope: "user" as const,
      _: [],
      $0: "opencode",
    }
    await McpEnableCommand.handler(args)

    const config = await Config.global()
    expect(config.mcp?.["user-disabled-server"].enabled).toBe(true)
  })

  test("disable MCP server in project scope", async () => {
    // First add an enabled server to project config
    await Bun.write(
      testProjectConfigPath,
      JSON.stringify(
        {
          mcp: {
            "enabled-server": {
              type: "local",
              command: ["node", "server.js"],
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    )

    const args = {
      name: "enabled-server",
      scope: "project" as const,
      _: [],
      $0: "opencode",
    }
    await McpDisableCommand.handler(args)

    const projectConfig = await Config.get()
    expect(projectConfig.mcp?.["enabled-server"].enabled).toBe(false)
  })

  test("disable MCP server in user scope", async () => {
    // First add an enabled server to user config
    await Bun.write(
      testConfigPath,
      JSON.stringify(
        {
          mcp: {
            "user-enabled-server": {
              type: "remote",
              url: "https://example.com/mcp",
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    )

    const args = {
      name: "user-enabled-server",
      scope: "user" as const,
      _: [],
      $0: "opencode",
    }
    await McpDisableCommand.handler(args)

    const config = await Config.global()
    expect(config.mcp?.["user-enabled-server"].enabled).toBe(false)
  })

  test("enable non-existent MCP server shows error", async () => {
    const stderr = captureStderr()

    const args = {
      name: "non-existent",
      scope: "project" as const,
      _: [],
      $0: "opencode",
    }
    await McpEnableCommand.handler(args)

    expect(stderr.getOutput()).toContain(
      'MCP server "non-existent" not found in project config',
    )

    stderr.restore()
  })

  test("disable non-existent MCP server shows error", async () => {
    const stderr = captureStderr()

    const args = {
      name: "non-existent",
      scope: "user" as const,
      _: [],
      $0: "opencode",
    }
    await McpDisableCommand.handler(args)

    expect(stderr.getOutput()).toContain(
      'MCP server "non-existent" not found in user config',
    )

    stderr.restore()
  })

  test("list shows disabled status for MCP servers", async () => {
    // Add servers with different enabled states
    await Bun.write(
      testConfigPath,
      JSON.stringify(
        {
          mcp: {
            "enabled-server": {
              type: "local",
              command: ["node", "enabled.js"],
              enabled: true,
            },
            "disabled-server": {
              type: "local",
              command: ["node", "disabled.js"],
              enabled: false,
            },
            "default-server": {
              type: "local",
              command: ["node", "default.js"],
            },
          },
        },
        null,
        2,
      ),
    )

    const stderr = captureStderr()

    await McpListCommand.handler({ $0: "opencode", _: [] })

    const output = stderr.getOutput()
    expect(output).toContain("enabled-server (local)")
    expect(output).toContain("disabled-server (local) (disabled)")
    expect(output).toContain("default-server (local)")
    stderr.restore()
  })

  test("get shows enabled status for MCP servers", async () => {
    // Add a disabled server to project config
    await Bun.write(
      testProjectConfigPath,
      JSON.stringify(
        {
          mcp: {
            "status-server": {
              type: "local",
              command: ["node", "server.js"],
              enabled: false,
            },
          },
        },
        null,
        2,
      ),
    )

    const stderr = captureStderr()

    const args = {
      name: "status-server",
      _: [],
      $0: "opencode",
    }
    await McpGetCommand.handler(args)

    const output = stderr.getOutput()
    expect(output).toContain("Enabled: false")
    stderr.restore()
  })
})
