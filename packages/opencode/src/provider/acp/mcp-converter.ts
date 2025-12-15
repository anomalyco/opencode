import type { McpServer, Stdio, HttpHeader, EnvVariable } from "@agentclientprotocol/sdk"
import type { Config } from "../../config/config"
import { Log } from "../../util/log"

const log = Log.create({ service: "acp-mcp-converter" })

/**
 * Convert OpenCode MCP configuration to ACP McpServer format
 *
 * OpenCode supports:
 * - local: stdio-based MCPs with command + args + environment
 * - remote: http/sse MCPs with URL + headers
 *
 * ACP supports:
 * - Stdio: { name, command, args, env }
 * - http: { type: "http", name, url, headers }
 * - sse: { type: "sse", name, url, headers }
 */
export function convertMcpToAcp(name: string, mcp: Config.Mcp): McpServer[] {
  // Skip disabled MCPs
  if (mcp.enabled === false) {
    log.info("Skipping disabled MCP", { name })
    return []
  }

  if (mcp.type === "local") {
    return convertLocalMcp(name, mcp)
  }

  if (mcp.type === "remote") {
    return convertRemoteMcp(name, mcp)
  }

  log.warn("Unknown MCP type", { name, type: (mcp as any).type })
  return []
}

/**
 * Convert local (stdio) MCP to ACP format
 */
function convertLocalMcp(name: string, mcp: Extract<Config.Mcp, { type: "local" }>): McpServer[] {
  const [command, ...args] = mcp.command

  // Convert environment variables to ACP format
  const env: EnvVariable[] = mcp.environment
    ? Object.entries(mcp.environment).map(([name, value]) => ({
        name,
        value,
      }))
    : []

  const acpMcp: Stdio = {
    name,
    command,
    args,
    env,
  }

  log.info("Converted local MCP to stdio", {
    name,
    command,
    argsCount: args.length,
    envCount: env.length,
  })

  return [acpMcp]
}

/**
 * Convert remote MCP to ACP format
 *
 * NOTE: Currently only stdio MCPs are supported by most ACP agents.
 * Remote (http/sse) MCPs are skipped for now.
 */
function convertRemoteMcp(name: string, mcp: Extract<Config.Mcp, { type: "remote" }>): McpServer[] {
  log.warn("Remote MCPs not yet supported by ACP agents - skipping", {
    name,
    url: mcp.url,
  })

  // TODO: Once cursor-agent supports http/sse MCPs, uncomment this:
  // const headers: HttpHeader[] = mcp.headers
  //   ? Object.entries(mcp.headers).map(([name, value]) => ({ name, value }))
  //   : []
  // return [
  //   { type: "http", name: `${name}-http`, url: mcp.url, headers },
  //   { type: "sse", name: `${name}-sse`, url: mcp.url, headers },
  // ]

  return []
}

/**
 * Convert all MCPs from OpenCode config to ACP format
 */
export function convertAllMcps(mcpConfig: Record<string, Config.Mcp>): McpServer[] {
  const result: McpServer[] = []

  for (const [name, mcp] of Object.entries(mcpConfig)) {
    const converted = convertMcpToAcp(name, mcp)
    result.push(...converted)
  }

  log.info("Converted all MCPs", {
    totalMcps: Object.keys(mcpConfig).length,
    convertedServers: result.length,
  })

  return result
}
