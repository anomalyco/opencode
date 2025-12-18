import z from "zod"
import type { Config } from "./config"
import { Log } from "../util/log"
import path from "path"
import os from "os"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { parse as parseJsonc, type ParseError as JsoncParseError } from "jsonc-parser"

const log = Log.create({ service: "mcp-json" })

// Schema for local/stdio MCP server (Claude/Cursor format)
const McpJsonLocalServer = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

// Schema for remote HTTP/SSE MCP server (Claude/Cursor format)
const McpJsonRemoteServer = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
})

// Combined server schema - discriminated by presence of url vs command
const McpJsonServer = z.union([McpJsonRemoteServer, McpJsonLocalServer])
type McpJsonServer = z.infer<typeof McpJsonServer>

// Root mcp.json schema
const McpJson = z.object({
  mcpServers: z.record(z.string(), McpJsonServer).optional(),
})
type McpJson = z.infer<typeof McpJson>

/**
 * Normalize environment variable syntax from ${env:VAR} (Claude/Cursor style) to {env:VAR} (OpenCode style)
 */
function normalizeEnvSyntax(value: string): string {
  return value.replace(/\$\{env:([^}]+)\}/g, "{env:$1}")
}

/**
 * Transform mcp.json format to OpenCode's internal MCP config format
 */
function transform(mcpJson: McpJson): Record<string, Config.Mcp> {
  const result: Record<string, Config.Mcp> = {}
  if (!mcpJson.mcpServers) return result

  for (const [name, server] of Object.entries(mcpJson.mcpServers)) {
    if ("url" in server) {
      // Remote server
      const headers: Record<string, string> | undefined = server.headers
        ? Object.fromEntries(Object.entries(server.headers).map(([k, v]) => [k, normalizeEnvSyntax(v)]))
        : undefined

      result[name] = {
        type: "remote",
        url: normalizeEnvSyntax(server.url),
        ...(headers && { headers }),
      }
    } else {
      // Local server
      const environment: Record<string, string> | undefined = server.env
        ? Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, normalizeEnvSyntax(v)]))
        : undefined

      result[name] = {
        type: "local",
        command: [server.command, ...(server.args ?? [])],
        ...(environment && { environment }),
      }
    }
  }
  return result
}

/**
 * Load and parse an mcp.json file
 */
async function loadFile(filepath: string): Promise<Record<string, Config.Mcp>> {
  log.info("loading mcp.json", { path: filepath })
  const text = await Bun.file(filepath)
    .text()
    .catch((err) => {
      if (err.code === "ENOENT") return undefined
      log.error("failed to read mcp.json", { path: filepath, error: err })
      return undefined
    })

  if (!text) return {}

  const errors: JsoncParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })

  if (errors.length) {
    log.error("failed to parse mcp.json", { path: filepath, errors })
    return {}
  }

  const parsed = McpJson.safeParse(data)
  if (!parsed.success) {
    log.error("invalid mcp.json schema", { path: filepath, issues: parsed.error.issues })
    return {}
  }

  return transform(parsed.data)
}

/**
 * Load all mcp.json files from standard locations and merge them.
 * Priority (lowest to highest):
 * 1. ~/.cursor/mcp.json
 * 2. ~/.claude/mcp.json
 * 3. ~/.config/opencode/mcp.json
 * 4. ~/.opencode/mcp.json
 * 5. <project>/.cursor/mcp.json
 * 6. <project>/.claude/mcp.json
 * 7. <project>/.opencode/mcp.json
 * 8. <project>/mcp.json
 */
export async function loadAllMcpJson(): Promise<Record<string, Config.Mcp>> {
  let result: Record<string, Config.Mcp> = {}

  // Global locations (lowest priority first)
  const globalPaths = [
    path.join(os.homedir(), ".cursor", "mcp.json"),
    path.join(os.homedir(), ".claude", "mcp.json"),
    path.join(os.homedir(), ".config", "opencode", "mcp.json"),
    path.join(Global.Path.config, "mcp.json"), // ~/.opencode/mcp.json
  ]

  for (const filepath of globalPaths) {
    const servers = await loadFile(filepath)
    result = { ...result, ...servers }
  }

  // Project locations (higher priority)
  const projectPaths = [
    path.join(Instance.directory, ".cursor", "mcp.json"),
    path.join(Instance.directory, ".claude", "mcp.json"),
  ]

  // Also search up for .opencode/mcp.json
  const opencodeDirectories = await Array.fromAsync(
    Filesystem.up({
      targets: [".opencode"],
      start: Instance.directory,
      stop: Instance.worktree,
    }),
  )

  for (const dir of opencodeDirectories.toReversed()) {
    projectPaths.push(path.join(dir, "mcp.json"))
  }

  // Root mcp.json has highest priority
  projectPaths.push(path.join(Instance.directory, "mcp.json"))

  for (const filepath of projectPaths) {
    const servers = await loadFile(filepath)
    result = { ...result, ...servers }
  }

  return result
}
