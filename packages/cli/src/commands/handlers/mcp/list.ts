import { EOL } from "node:os"
import * as Effect from "effect/Effect"
import { createOpencodeClient, type McpServer } from "@opencode-ai/sdk/v2/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Service } from "@opencode-ai/client/effect"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.mcp.commands.list,
  Effect.fn("cli.mcp.list")(function* () {
    const options = yield* ServiceConfig.options()
    const found = yield* Service.discover(options)
    const transport = found ?? (yield* Service.start(options))
    const client = createOpencodeClient({ baseUrl: transport.url, headers: transport.headers })
    const response = yield* Effect.promise(() => client.v2.mcp.list({ location: { directory: process.cwd() } }))
    const servers = (response.data?.data ?? []).toSorted((a, b) => a.name.localeCompare(b.name))
    if (servers.length === 0) {
      process.stdout.write("No MCP servers configured" + EOL)
      return
    }
    const width = Math.max(...servers.map((server) => server.name.length))
    const lines = servers.map(
      (server) => `${icon(server.status)} ${server.name.padEnd(width)}  ${describe(server.status)}`,
    )
    process.stdout.write(lines.join(EOL) + EOL)
  }),
)

function icon(status: McpServer["status"]) {
  switch (status.status) {
    case "connected":
      return "✓"
    case "needs_auth":
      return "⚠"
    case "failed":
    case "needs_client_registration":
      return "✗"
    default:
      return "○"
  }
}

function describe(status: McpServer["status"]) {
  switch (status.status) {
    case "needs_auth":
      return "needs authentication"
    case "needs_client_registration":
      return `needs client registration: ${status.error}`
    case "failed":
      return `failed: ${status.error}`
    default:
      return status.status
  }
}
