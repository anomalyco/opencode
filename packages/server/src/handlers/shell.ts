import { Shell } from "@opencode/core/shell"
import { Location } from "@opencode/core/location"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { ShellNotFoundError, InvalidRequestError } from "@opencode/protocol/errors"
import { Api } from "../api"
import { response } from "../location"
import { FSUtil } from "@opencode-ai/util/fs-util"

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
          const fs = yield* FSUtil.Service
          const requestedCwd = ctx.payload.cwd || location.directory
          const resolvedCwd = yield* fs.realPath(requestedCwd).pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(requestedCwd)),
          )
          if (!(yield* fs.contains(location.directory, resolvedCwd))) {
            return yield* new InvalidRequestError({
              message: "CWD must be within the project directory",
              kind: "shell_cwd_outside_project",
            })
          }
          return yield* response(
            shell.create({ ...ctx.payload, cwd: resolvedCwd }).pipe(Effect.orDie),
          )
        }),
      )
      .handle(
        "shell.get",
        Effect.fn(function* (ctx) {
          const shell = yield* Shell.Service
          return yield* response(
            shell
              .get(ctx.params.id)
              .pipe(
                Effect.catchTag(
                  "Shell.NotFoundError",
                  () =>
                    new ShellNotFoundError({ id: ctx.params.id, message: `Shell command not found: ${ctx.params.id}` }),
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
            shell
              .output(ctx.params.id, { cursor: ctx.query.cursor, limit: ctx.query.limit })
              .pipe(
                Effect.catchTag(
                  "Shell.NotFoundError",
                  () =>
                    new ShellNotFoundError({ id: ctx.params.id, message: `Shell command not found: ${ctx.params.id}` }),
                ),
              ),
          )
        }),
      )
      .handle(
        "shell.remove",
        Effect.fn(function* (ctx) {
          const shell = yield* Shell.Service
          yield* shell.remove(ctx.params.id).pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.void))
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)