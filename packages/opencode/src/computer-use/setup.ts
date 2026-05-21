/**
 * Auto-registration of Computer Use MCP server into opencode config.
 *
 * Called during MCP initialization to inject the computer-use server
 * configuration if it's not already present in user config.
 */

import path from "path"
import { isSupportedPlatform } from "./python-bridge.js"

export const COMPUTER_USE_MCP_NAME = "computer-use"

/** Get the MCP config entry for the computer-use server. */
export function getComputerUseMcpConfig() {
  if (!isSupportedPlatform()) return undefined

  // Resolve the path to the MCP server entry point
  // This runs as `bun run <path>` via stdio transport
  const serverPath = path.resolve(__dirname, "index.ts")

  return {
    type: "local" as const,
    command: [process.execPath, serverPath],
    enabled: true,
    timeout: 30_000,
  }
}

/**
 * Inject computer-use into the MCP config if not already present.
 * Returns the merged config. Does not mutate the input.
 */
export function injectComputerUseMcp(
  existingMcp: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const config = getComputerUseMcpConfig()
  if (!config) return existingMcp ?? {}

  const mcp = { ...(existingMcp ?? {}) }

  // Don't override if user has explicitly configured it
  if (mcp[COMPUTER_USE_MCP_NAME] !== undefined) {
    return mcp
  }

  mcp[COMPUTER_USE_MCP_NAME] = config
  return mcp
}
