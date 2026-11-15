import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { OpenCode, type McpServer } from "@opencode/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Service } from "@opencode/client/effect/service"
import { ServerConnection } from "../../../services/server-connection"
import { describe, icon } from "./list"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.mcp.commands.reconnect,
  Effect.fn("cli.mcp.reconnect")(function* (input) {
    const { endpoint } = yield* ServerConnection.resolve()
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const name = Option.getOrUndefined(input.name)
    const before = yield* Effect.promise(() => client.mcp.list({ location }))
    if (name && !before.data.some((server) => server.name === name))
      return yield* Effect.fail(new Error(`MCP server not found: ${name}`))
    const targets = reconnectTargets(before.data, name)
    if (targets.length === 0) {
      process.stdout.write("No failed MCP servers" + EOL)
      return
    }
    yield* Effect.forEach(
      targets,
      (server) => Effect.promise(() => client.experimental.mcp.connect({ server, location })),
      { discard: true },
    )
    const after = yield* Effect.promise(() => client.mcp.list({ location }))
    const lines = targets.map((server) => {
      const status = after.data.find((item) => item.name === server)?.status
      return status ? `${icon(status)} ${server} ${describe(status)}` : `${icon({ status: "pending" })} ${server}`
    })
    process.stdout.write(lines.join(EOL) + EOL)
    // Let scripts branch on the outcome instead of parsing the lines above.
    if (stillDown(after.data, targets).length > 0) process.exitCode = 1
  }),
)

/** The named server, or every failed server when no name is given. */
export function reconnectTargets(servers: McpServer[], name?: string) {
  if (name) return [name]
  return servers.filter((server) => server.status.status === "failed").map((server) => server.name)
}

/** Targets that are still not connected after the attempt. */
export function stillDown(servers: McpServer[], targets: string[]) {
  return targets.filter((name) => {
    const status = servers.find((server) => server.name === name)?.status.status
    return status === "failed" || status === "needs_auth"
  })
}
