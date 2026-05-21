#!/usr/bin/env node
/**
 * Computer Use MCP Server — entry point.
 *
 * Started by opencode as a local MCP server via stdio.
 * The MCP client (opencode) communicates with this process
 * through stdin/stdout JSON-RPC messages.
 */

import { startServer } from "./server.js"

startServer().catch((err) => {
  console.error("Failed to start Computer Use MCP server:", err)
  process.exit(1)
})
