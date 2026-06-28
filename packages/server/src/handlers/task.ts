import { TaskService } from "@opencode-ai/core/task"
import { Effect, Stream } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { InvalidRequestError, TaskNotFoundError } from "@opencode-ai/protocol/errors"

export const TaskHandler = HttpApiBuilder.group(Api, "server.task", (handlers) =>
  Effect.gen(function* () {
    const task = yield* TaskService.Service

    return handlers
      .handle(
        "task.start",
        Effect.fn(function* (ctx) {
          return yield* response(
            task
              .start({
                name: ctx.payload.name,
                command: ctx.payload.command,
                cwd: ctx.payload.cwd ?? undefined,
                port: ctx.payload.port ?? undefined,
                metadata: ctx.payload.metadata ?? undefined,
              })
              .pipe(
                Effect.mapError(
                  (err) => new InvalidRequestError({ message: err instanceof Error ? err.message : String(err) }),
                ),
              ),
          )
        }),
      )
      .handle(
        "task.stop",
        Effect.fn(function* (ctx) {
          return yield* response(
            task.stop(ctx.params.taskID).pipe(
              Effect.catch(() =>
                Effect.fail(
                  new TaskNotFoundError({
                    taskID: ctx.params.taskID,
                    message: `Task not found or failed to stop: ${ctx.params.taskID}`,
                  }),
                ),
              ),
            ),
          )
        }),
      )
      .handle(
        "task.restart",
        Effect.fn(function* (ctx) {
          return yield* response(
            task.restart(ctx.params.taskID).pipe(
              Effect.catch(() =>
                Effect.fail(
                  new TaskNotFoundError({
                    taskID: ctx.params.taskID,
                    message: `Task not found or failed to restart: ${ctx.params.taskID}`,
                  }),
                ),
              ),
            ),
          )
        }),
      )
      .handle(
        "task.kill",
        Effect.fn(function* (ctx) {
          return yield* response(
            task.kill(ctx.params.taskID).pipe(
              Effect.catch(() =>
                Effect.fail(
                  new TaskNotFoundError({
                    taskID: ctx.params.taskID,
                    message: `Task not found or failed to kill: ${ctx.params.taskID}`,
                  }),
                ),
              ),
            ),
          )
        }),
      )
      .handle(
        "task.list",
        Effect.fn(function* () {
          return yield* response(
            task.list().pipe(
              Effect.mapError(
                (err) => new InvalidRequestError({ message: err instanceof Error ? err.message : String(err) }),
              ),
            ),
          )
        }),
      )
      .handle(
        "task.get",
        Effect.fn(function* (ctx) {
          return yield* response(
            task.get(ctx.params.taskID).pipe(
              Effect.flatMap((info) => {
                if (!info) {
                  return Effect.fail(
                    new TaskNotFoundError({
                      taskID: ctx.params.taskID,
                      message: `Task not found: ${ctx.params.taskID}`,
                    }),
                  )
                }
                return Effect.succeed(info)
              }),
              Effect.mapError((err) =>
                err instanceof TaskNotFoundError
                  ? err
                  : new TaskNotFoundError({
                      taskID: ctx.params.taskID,
                      message: err instanceof Error ? err.message : String(err),
                    }),
              ),
            ),
          )
        }),
      )
      .handle(
        "task.delete",
        Effect.fn(function* (ctx) {
          yield* task.delete(ctx.params.taskID).pipe(
            Effect.catch(() =>
              Effect.fail(
                new TaskNotFoundError({
                  taskID: ctx.params.taskID,
                  message: `Task not found or failed to delete: ${ctx.params.taskID}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "task.logs",
        Effect.fn(function* (ctx) {
          return yield* response(
            task.logs(ctx.params.taskID, { lines: ctx.query.lines }).pipe(
              Effect.catch(() =>
                Effect.fail(
                  new TaskNotFoundError({
                    taskID: ctx.params.taskID,
                    message: `Logs not found for task: ${ctx.params.taskID}`,
                  }),
                ),
              ),
            ),
          )
        }),
      )
      .handle(
        "task.streamLogs",
        Effect.fn((ctx) =>
          Effect.succeed(
            task.streamLogs(ctx.params.taskID).pipe(
              Stream.orDie,
            ),
          ),
        ),
      )
  }),
)
