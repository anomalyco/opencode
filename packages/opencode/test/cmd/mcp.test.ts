import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  McpAddCommand,
  McpRemoveCommand,
  McpListCommand,
  McpGetCommand,
  McpAddJsonCommand,
} from "../../src/cli/cmd/mcp"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { UI } from "../../src/cli/ui"
import path from "path"
import fs from "fs"

const testConfigDir = path.join(process.cwd(), "test-config")
const testConfigPath = path.join(testConfigDir, "config.json")

beforeEach(async () => {
  // Create test config directory
  await fs.promises.mkdir(testConfigDir, { recursive: true })

  // Mock Global.Path.config to use test directory
  // @ts-expect-error
  Global.Path.config = testConfigDir

  // Create empty config
  await Bun.write(testConfigPath, JSON.stringify({}, null, 2))
})

afterEach(async () => {
  // Clean up test config
  await fs.promises.rm(testConfigDir, { recursive: true, force: true })

  // Clean up project config files created during tests
  const projectConfigPath = path.join(process.cwd(), "opencode.json")
  await fs.promises.rm(projectConfigPath, { force: true })
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
    const projectConfigPath = path.join(process.cwd(), "opencode.json")
    const projectConfig = JSON.parse(await Bun.file(projectConfigPath).text())
    expect(projectConfig.mcp).toBeDefined()
    expect(projectConfig.mcp["test-server"]).toMatchObject({
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
    expect(config.mcp!["remote-server"]).toMatchObject({
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

    const projectConfigPath = path.join(process.cwd(), "opencode.json")
    const projectConfig = JSON.parse(await Bun.file(projectConfigPath).text())
    expect(projectConfig.mcp["sse-server"]).toMatchObject({
      type: "remote",
      url: "http://localhost:8080/mcp",
      headers: {
        "X-API-Key": "abc123",
        "Content-Type": "application/json",
      },
    })
  })

  test("validate transport constraints", async () => {
    const originalError = UI.error
    let errorMessage = ""
    UI.error = (msg: string) => {
      errorMessage = msg
    }

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
    expect(errorMessage).toContain(
      "stdio transport requires a command, not a URL",
    )

    UI.error = originalError
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
    expect(config.mcp!["user-server"]).toMatchObject({
      type: "local",
      command: ["bun", "run", "server.ts"],
      environment: {
        DEBUG: "true",
      },
    })
  })

  test("remove MCP server from project scope", async () => {
    // First add a server to project config
    const projectConfigPath = path.join(process.cwd(), "opencode.json")
    await Bun.write(
      projectConfigPath,
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

    const projectConfig = JSON.parse(await Bun.file(projectConfigPath).text())
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
    const originalError = UI.error
    let errorMessage = ""
    UI.error = (msg: string) => {
      errorMessage = msg
    }

    const args = {
      name: "non-existent",
      scope: "project" as const,
      _: [],
      $0: "opencode",
    }
    await McpRemoveCommand.handler(args)

    expect(errorMessage).toContain(
      'MCP server "non-existent" not found in project config',
    )

    UI.error = originalError
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

    const projectConfigPath = path.join(process.cwd(), "opencode.json")
    const projectConfig = JSON.parse(await Bun.file(projectConfigPath).text())
    expect(projectConfig.mcp["json-server"]).toMatchObject({
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
    expect(config.mcp!["user-json-server"]).toMatchObject({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer token" },
    })
  })

  test("list empty MCP servers", async () => {
    const originalPrintln = UI.println
    const logs: string[] = []
    UI.println = (...messages: string[]) => logs.push(messages.join(" "))

    await McpListCommand.handler({ $0: "opencode", _: [] })

    UI.println = originalPrintln
    expect(logs.some((log) => log.includes("No MCP servers configured"))).toBe(
      true,
    )
  })

  test("get MCP server details", async () => {
    // Add a server first
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

    const originalPrintln = UI.println
    const logs: string[] = []
    UI.println = (...messages: string[]) => logs.push(messages.join(" "))

    const args = {
      name: "detail-server",
      _: [],
      $0: "opencode",
    }
    await McpGetCommand.handler(args)

    UI.println = originalPrintln
    expect(logs.some((log) => log.includes("MCP Server: detail-server"))).toBe(
      true,
    )
    expect(logs.some((log) => log.includes("Type: local"))).toBe(true)
  })
})
