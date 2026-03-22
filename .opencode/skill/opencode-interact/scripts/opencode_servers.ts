#!/usr/bin/env bun
/** List reachable OpenCode instances that this skill can take over. */

import { parseArgs } from "util"
import { list } from "./server"

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    SESSION_ID: { type: "string" },
    PREFER_DESKTOP: { type: "boolean", default: true },
    help: { type: "boolean", short: "h" },
  },
})

if (values.help) {
  console.error("Usage: bun run scripts/opencode_servers.ts [--SESSION_ID ses_xxx]")
  process.exit(0)
}

const result = await list({
  preferDesktop: values.PREFER_DESKTOP !== false,
  sessionID: values.SESSION_ID,
})

console.log(JSON.stringify({ success: true, servers: result }, null, 2))
