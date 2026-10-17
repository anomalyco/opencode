import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { OpenCode, isMcpServerNotFoundError, type McpToolCatalog } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(Commands.commands.mcp.commands.tools, (input) =>
  Effect.gen(function* () {
    const name = Option.getOrUndefined(input.name)
    const connection = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({
      baseUrl: connection.endpoint.url,
      headers: Service.headers(connection.endpoint),
    })
    const response = yield* Effect.tryPromise({
      try: (signal) => client.mcp.tools({ server: name, location: { directory: process.cwd() } }, { signal }),
      catch: (cause) => cause,
    })
    const servers = response.data.toSorted((a, b) => a.name.localeCompare(b.name))
    if (servers.length === 0) {
      process.stdout.write(`No MCP servers configured. Add one with: opencode mcp add${EOL}`)
      return
    }
    const lines = servers.flatMap((server) => {
      if (server.status.status !== "connected") {
        if (name !== undefined || server.status.status !== "disabled") process.exitCode = 1
        return [`${server.name}: ${describe(server)}`]
      }
      if (server.tools.length === 0) return [`${server.name}: No tools available`]
      return [
        `${server.name} (${server.tools.length} tool${server.tools.length === 1 ? "" : "s"})`,
        ...server.tools
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((tool) => {
            const description = name === undefined ? "" : tool.description?.replace(/\s+/g, " ").trim()
            return `  ${tool.name}${description ? ` - ${description}` : ""}`
          }),
      ]
    })
    process.stdout.write(lines.join(EOL) + EOL)
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(
          (isMcpServerNotFoundError(error)
            ? `MCP server not found: ${error.server}. List configured servers with: opencode mcp list`
            : errorMessage(error)) + EOL,
        )
        process.exitCode = 1
      }),
    ),
  ),
)

function describe(server: McpToolCatalog) {
  switch (server.status.status) {
    case "disabled":
      return "disabled"
    case "needs_auth":
      return `needs authentication (opencode mcp auth ${server.name})`
    case "failed":
      return `failed: ${server.status.error.replace(/\s+/g, " ").trim()}`
    case "pending":
      return "not connected"
    default:
      return server.status.status
  }
}
