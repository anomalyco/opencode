import { Config } from "@opencode/core/config"
import { Mcp } from "@opencode/core/mcp/index"
import { McpServerNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

const notFound = <A, R>(effect: Effect.Effect<A, Mcp.NotFoundError, R>) =>
  effect.pipe(Effect.mapError((error) => new McpServerNotFoundError({ server: error.server, message: error.message })))

// Servers without a writable config file (runtime additions, remote config) keep the runtime toggle only.
const persistDisabled = Effect.fn(function* (server: string, disabled: boolean) {
  const config = yield* Config.Service
  if (!config.setMcpDisabled) return false
  return yield* config
    .setMcpDisabled(server, disabled)
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to persist MCP server state", { server, error }).pipe(Effect.as(false)),
      ),
    )
})

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "mcp.list",
        Effect.fn(function* () {
          const service = yield* Mcp.Service
          return yield* response(
            service
              .servers()
              .pipe(
                Effect.map((servers) =>
                  servers.map((info) => ({ name: info.name, status: info.status, integrationID: info.integrationID })),
                ),
              ),
          )
        }),
      )
      .handle(
        "mcp.add",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* service.add(ctx.params.server, ctx.payload.config)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.remove",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* notFound(service.remove(ctx.params.server))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.connect",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* persistDisabled(ctx.params.server, false)
          // Connect even after a config edit: the merged config can still disable the server, and the
          // reload that follows the edit at worst restarts it.
          yield* notFound(service.connect(ctx.params.server))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.disconnect",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* notFound(service.disconnect(ctx.params.server))
          yield* persistDisabled(ctx.params.server, true)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.resource.catalog",
        Effect.fn(function* () {
          const service = yield* Mcp.Service
          return yield* response(service.resourceCatalog())
        }),
      )
  }),
)
