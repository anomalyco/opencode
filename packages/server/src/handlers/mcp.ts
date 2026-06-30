import { MCP } from "@opencode-ai/core/mcp/index"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "mcp.list",
      Effect.fn(function* () {
        const service = yield* MCP.Service
        return yield* response(
          service.servers().pipe(Effect.map((servers) => servers.map((info) => ({ name: info.name, status: info.status })))),
        )
      }),
    )
  }),
)
