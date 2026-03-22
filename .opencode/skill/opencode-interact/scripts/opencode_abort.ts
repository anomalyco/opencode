#!/usr/bin/env bun
/** Abort a running OpenCode session. */

import { parseArgs } from "util"
import { pub, req, resolve } from "./server"

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    SESSION_ID: { type: "string" },
    PORT: { type: "string" },
    USERNAME: { type: "string" },
    PASSWORD: { type: "string" },
    PREFER_DESKTOP: { type: "boolean", default: true },
    help: { type: "boolean", short: "h" },
  },
})

if (values.help || !values.SESSION_ID) {
  console.error("Usage: bun run scripts/opencode_abort.ts --SESSION_ID ses_xxx [--PORT 4098]")
  process.exit(values.help ? 0 : 1)
}

const target = await resolve({
  port: values.PORT ? parseInt(values.PORT, 10) : undefined,
  username: values.USERNAME,
  password: values.PASSWORD,
  preferDesktop: values.PREFER_DESKTOP !== false,
  sessionID: values.SESSION_ID,
})

const resp = await req(target, `/session/${values.SESSION_ID}/abort`, { method: "POST" })
if (!resp.ok) {
  console.log(
    JSON.stringify(
      { success: false, server: pub(target), error: `HTTP ${resp.status}: ${await resp.text()}` },
      null,
      2,
    ),
  )
  process.exit(1)
}

const text = await resp.text()
console.log(
  JSON.stringify(
    { success: true, server: pub(target), session_id: values.SESSION_ID, response: text || null },
    null,
    2,
  ),
)
