export * as FigmaPlugin from "./figma"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect } from "effect"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { MCP } from "../mcp/index"

const CLIENT_ID = "3zVHNs9kINDDrk8loekLZV"
const CALLBACK_PORT = 19876

export function apply(server: typeof ConfigMCP.Server.Type) {
  if (server.type !== "remote" || server.oauth === false) return server
  if (!URL.canParse(server.url) || new URL(server.url).hostname !== "mcp.figma.com") return server
  if (server.oauth) {
    Object.assign(server.oauth, { client_id: server.oauth.client_id ?? CLIENT_ID, callback_port: CALLBACK_PORT })
    return server
  }
  Object.assign(server, { oauth: { client_id: CLIENT_ID, callback_port: CALLBACK_PORT } })
  return server
}

export const Plugin = define({
  id: "opencode.figma",
  effect: Effect.fn(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const documents = (yield* config.entries()).filter((entry): entry is Config.Document => entry.type === "document")
    for (const entry of documents) {
      for (const [name, server] of Object.entries(entry.info.mcp?.servers ?? {})) {
        if (server.type !== "remote" || !URL.canParse(server.url) || new URL(server.url).hostname !== "mcp.figma.com")
          continue
        yield* mcp.add(name, apply(server))
      }
    }
  }),
})
