import { Shell } from "@opencode-ai/core/shell"
import { Location } from "@opencode-ai/core/location"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { ShellNotFoundError } from "@opencode-ai/protocol/errors"
import { Api } from "../api"
import { response } from "../location"

export const ShellHandler = HttpApiBuilder.group(Api, "server.shell", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "shell.list",
        Effect.fn(function* () {
          const shell = yield* Shell.Service
          return yield* response(shell.list())
        }),
      )
      .handle(
        "shell.create",
        Effect.fn(function* (ctx) {
          const shell = yield* Shell.Service
          const location = yield* Location.Service
          return yield* response(shell.create({ ...ctx.payload, cwd: ctx.payload.cwd || location.directory }))
        }),
      )
      .handle(
        "shell.get",
        Effect.fn(function* (ctx) {
          const shell = yield* Shell.Service
          return yield* response(
            shell.get(ctx.params.id).pipe(
              Effect.catchTag(
                "Shell.NotFoundError",
                () => new ShellNotFoundError({ id: ctx.params.id, message: `Shell command not found: ${ctx.params.id}` }),
              ),
            ),
          )
        }),
      )
      .handle(
        "shell.timeout",
        Effect.fn(function* (ctx) {
          const shell = yield* Shell.Service
          return yield* response(
            shell.timeout(ctx.params.id, ctx.payload.timeout).pipe(
              Effect.catchTag(
                "Shell.NotFoundError",
                () => new ShellNotFoundError({ id: ctx.params.id, message: `Shell command not found: ${ctx.params.id}` }),
              ),
            ),
          )
        }),
      )
      .handle(
        "shell.output",
        Effect.fn(function* (ctx) {
          const shell = yield* Shell.Service
          return yield* response(
            shell.output(ctx.params.id, { cursor: ctx.query.cursor, limit: ctx.query.limit }).pipe(
              Effect.catchTag(
                "Shell.NotFoundError",
                () => new ShellNotFoundError({ id: ctx.params.id, message: `Shell command not found: ${ctx.params.id}` }),
              ),
            ),
          )
        }),
      )
      .handle(
        "shell.remove",
        Effect.fn(function* (ctx) {
          const shell = yield* Shell.Service
          yield* shell.remove(ctx.params.id).pipe(
            Effect.catchTag(
              "Shell.NotFoundError",
              () => new ShellNotFoundError({ id: ctx.params.id, message: `Shell command not found: ${ctx.params.id}` }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
