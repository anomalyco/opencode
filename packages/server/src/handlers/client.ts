import { Client } from "@opencode/core/client"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { ClientNotFoundError, ConflictError } from "@opencode/protocol/errors"
import { Api } from "../api"

function missingClient(error: Client.NotFoundError) {
  return new ClientNotFoundError({ clientID: error.id, message: error.message })
}

export const ClientHandler = HttpApiBuilder.group(Api, "server.client", (handlers) =>
  Effect.gen(function* () {
    const client = yield* Client.Service
    return handlers
      .handle(
        "client.list",
        Effect.fn(function* () {
          return { data: yield* client.list() }
        }),
      )
      .handle(
        "client.register",
        Effect.fn(function* (ctx) {
          return {
            data: yield* client.register(ctx.payload).pipe(
              Effect.catchTag(
                "Client.AlreadyExistsError",
                (error) => new ConflictError({ resource: error.id, message: error.message }),
              ),
            ),
          }
        }),
      )
      .handle(
        "client.get",
        Effect.fn(function* (ctx) {
          return {
            data: yield* client.get(ctx.params.clientID).pipe(Effect.catchTag("Client.NotFoundError", missingClient)),
          }
        }),
      )
      .handle(
        "client.update",
        Effect.fn(function* (ctx) {
          return {
            data: yield* client
              .update(ctx.params.clientID, ctx.payload)
              .pipe(Effect.catchTag("Client.NotFoundError", missingClient)),
          }
        }),
      )
      .handle(
        "client.remove",
        Effect.fn(function* (ctx) {
          yield* client.remove(ctx.params.clientID).pipe(Effect.catchTag("Client.NotFoundError", missingClient))
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
