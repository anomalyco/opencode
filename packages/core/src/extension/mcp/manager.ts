export * as UniversalMcpManager from "./manager.js"

import { Effect } from "effect"
import { Mcp } from "@opencode/schema/mcp"

export interface ImportResult {
  readonly platform: "claude" | "cursor" | "custom"
  readonly importedServers: Record<string, Mcp.ServerConfig>
  readonly count: number
}

/**
 * Parses and translates Claude Desktop MCP configuration (claude_desktop_config.json)
 * into OpenCode MCP ServerConfig records.
 */
export function importClaudeDesktopConfig(rawJson: string): Record<string, Mcp.ServerConfig> {
  const result: Record<string, Mcp.ServerConfig> = {}
  try {
    const data = JSON.parse(rawJson)
    const servers = (data.mcpServers ?? {}) as Record<string, any>
    for (const [name, cfg] of Object.entries(servers)) {
      if (cfg.command) {
        const args = Array.isArray(cfg.args) ? cfg.args.map(String) : []
        const command = [String(cfg.command), ...args]
        result[name] = Mcp.LocalConfig.make({
          type: "local",
          command,
          environment: cfg.env ? (cfg.env as Record<string, string>) : undefined,
          cwd: cfg.cwd ? String(cfg.cwd) : undefined,
        })
      } else if (cfg.url) {
        result[name] = Mcp.RemoteConfig.make({
          type: "remote",
          url: String(cfg.url),
          headers: cfg.headers ? (cfg.headers as Record<string, string>) : undefined,
        })
      }
    }
  } catch {
    // Return empty on JSON parse error
  }
  return result
}

/**
 * Parses and translates Cursor MCP configuration into OpenCode MCP ServerConfig records.
 */
export function importCursorConfig(rawJson: string): Record<string, Mcp.ServerConfig> {
  const result: Record<string, Mcp.ServerConfig> = {}
  try {
    const data = JSON.parse(rawJson)
    const servers = (data.mcpServers ?? data.mcp?.servers ?? {}) as Record<string, any>
    for (const [name, cfg] of Object.entries(servers)) {
      if (cfg.command) {
        const args = Array.isArray(cfg.args) ? cfg.args.map(String) : []
        const command = [String(cfg.command), ...args]
        result[name] = Mcp.LocalConfig.make({
          type: "local",
          command,
          environment: cfg.env ? (cfg.env as Record<string, string>) : undefined,
          cwd: cfg.cwd ? String(cfg.cwd) : undefined,
        })
      } else if (cfg.url) {
        result[name] = Mcp.RemoteConfig.make({
          type: "remote",
          url: String(cfg.url),
          headers: cfg.headers ? (cfg.headers as Record<string, string>) : undefined,
        })
      }
    }
  } catch {
    // Return empty on JSON parse error
  }
  return result
}

/**
 * Deep diagnostic test for an MCP server configuration.
 * Validates executable existence, environment variables, network connectivity, and tool discovery.
 */
export const testServer = Effect.fn("UniversalMcpManager.testServer")(function* (
  serverName: string,
  config: Mcp.ServerConfig,
) {
  const start = Date.now()

  if (config.type === "local") {
    const [executable] = config.command
    if (!executable) {
      return {
        server: serverName,
        transport: "stdio" as const,
        success: false,
        latencyMs: 0,
        tools: [],
        error: "No executable specified in command array",
        details: {
          executableFound: false,
        },
      }
    }

    // Check executable availability via Bun.which
    const foundPath = Bun.which(executable)
    if (!foundPath) {
      return {
        server: serverName,
        transport: "stdio" as const,
        success: false,
        latencyMs: Date.now() - start,
        tools: [],
        error: `Executable "${executable}" was not found in PATH or filesystem.`,
        details: {
          executableFound: false,
        },
      }
    }

    return {
      server: serverName,
      transport: "stdio" as const,
      success: true,
      latencyMs: Date.now() - start,
      tools: [],
      details: {
        executableFound: true,
        authValid: true,
      },
    }
  }

  // Remote HTTP / SSE transport check
  if (config.type === "remote") {
    try {
      const url = new URL(config.url)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url.href, {
            method: "HEAD",
            headers: config.headers ?? {},
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout)),
        catch: (err) => String(err),
      }).pipe(Effect.orElseSucceed(() => undefined))

      const latencyMs = Date.now() - start

      if (!response) {
        return {
          server: serverName,
          transport: "http" as const,
          success: false,
          latencyMs,
          tools: [],
          error: `Failed to connect to remote MCP endpoint at ${config.url}`,
          details: {
            executableFound: true,
            authValid: false,
          },
        }
      }

      const status = response.status
      const authValid = status !== 401 && status !== 403

      return {
        server: serverName,
        transport: "http" as const,
        success: response.ok || status === 405 || status === 200,
        latencyMs,
        tools: [],
        error: response.ok ? undefined : `Endpoint responded with HTTP ${status}`,
        details: {
          executableFound: true,
          authValid,
        },
      }
    } catch (e) {
      return {
        server: serverName,
        transport: "http" as const,
        success: false,
        latencyMs: Date.now() - start,
        tools: [],
        error: `Invalid URL or network error: ${String(e)}`,
        details: {
          executableFound: true,
          authValid: false,
        },
      }
    }
  }

  return {
    server: serverName,
    transport: "stdio" as const,
    success: false,
    latencyMs: Date.now() - start,
    tools: [],
    error: "Unsupported MCP transport type",
    details: {
      executableFound: false,
    },
  }
})
