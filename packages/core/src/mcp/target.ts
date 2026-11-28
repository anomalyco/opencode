export * as McpTarget from "./target.js"

import type { Mcp } from "@opencode/schema/mcp"
import { Result } from "effect"
import { McpError } from "./errors.js"

export interface Local {
  readonly type: "local"
  readonly config: Mcp.LocalConfig
  readonly command: string
  readonly args: ReadonlyArray<string>
}

export interface Remote {
  readonly type: "remote"
  readonly config: Mcp.RemoteConfig
  readonly url: URL
  readonly redirect: URL | undefined
  readonly metadata: URL | undefined
}

/** A server's config with the parts that must parse already parsed, so nothing past here meets a raw URL or command. */
export type Target = Local | Remote

export const parse = (server: string, config: Mcp.ServerConfig): Result.Result<Target, McpError.InvalidConfigError> =>
  config.type === "local" ? local(server, config) : remote(server, config)

export const local = (server: string, config: Mcp.LocalConfig): Result.Result<Local, McpError.InvalidConfigError> => {
  const [command, ...args] = config.command
  if (command === undefined) return invalid(server, "MCP server command is empty")
  return Result.succeed({ type: "local", config, command, args })
}

export const remote = (
  server: string,
  config: Mcp.RemoteConfig,
): Result.Result<Remote, McpError.InvalidConfigError> => {
  const url = URL.parse(config.url)
  if (!url) return invalid(server, `Invalid MCP server URL: ${config.url}`)
  const oauth = config.oauth || undefined
  const redirect = oauth?.redirect_uri === undefined ? undefined : URL.parse(oauth.redirect_uri)
  if (redirect === null) return invalid(server, `Invalid MCP OAuth redirect_uri: ${oauth?.redirect_uri}`)
  const metadata = oauth?.auth_server_metadata_url === undefined ? undefined : URL.parse(oauth.auth_server_metadata_url)
  if (metadata === null)
    return invalid(server, `Invalid MCP OAuth auth_server_metadata_url: ${oauth?.auth_server_metadata_url}`)
  return Result.succeed({ type: "remote", config, url, redirect, metadata })
}

const invalid = (server: string, message: string) => Result.fail(new McpError.InvalidConfigError({ server, message }))

/** Keeps each variant's config paired with its type. */
export const withProtocol = (target: Target, protocol: Mcp.Protocol): Target =>
  target.type === "local"
    ? { ...target, config: { ...target.config, protocol } }
    : { ...target, config: { ...target.config, protocol } }

/**
 * Servers that bundle their own Code Mode (Cloudflare and others) expose raw tools when dialed with ?codemode=false,
 * which is what ours wants. Returns the URL to dial with it, or undefined to dial the configured URL as is. The
 * configured URL stays the OAuth identity.
 */
export const dialUrl = (url: URL, codemode: boolean | undefined) => {
  if (codemode === false || url.searchParams.has("codemode") || rejectsUnknownQuery(url)) return undefined
  const dialed = new URL(url)
  dialed.searchParams.set("codemode", "false")
  return dialed
}

/**
 * Some servers echo the ?codemode=false a connection dialed with back as their protected resource. Drops only that
 * parameter, so a refresh names the same resource the login did.
 */
export const withoutDialParams = (resource: URL, configured: URL) => {
  const result = new URL(resource)
  if (
    result.origin === configured.origin &&
    result.pathname === configured.pathname &&
    !configured.searchParams.has("codemode")
  )
    result.searchParams.delete("codemode")
  return result
}

// These servers reject any unknown query parameter and have no Code Mode of their own, so adding
// ?codemode=false only costs a failed request before the retry at the configured URL.
function rejectsUnknownQuery(url: URL) {
  // Google Workspace MCP (gmailmcp, drivemcp, calendarmcp, ...) returns 404.
  if (url.hostname.endsWith(".googleapis.com")) return true
  // Zoho MCP gateways (zohomcp.com, zohomcp.eu, ...) return 400.
  if (/(^|\.)zohomcp\.[a-z.]+$/.test(url.hostname)) return true
  // Loopback servers run on this machine (Figma Desktop's Dev Mode MCP returns 404), so they are not hosted Code Mode servers.
  return url.hostname === "localhost" || url.hostname === "[::1]" || /^127(\.\d+){3}$/.test(url.hostname)
}
