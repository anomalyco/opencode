import { TeamJules } from "@opencode-ai/core/teamjules"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { TeamJulesNotFoundError } from "@opencode-ai/protocol/errors"

export const TeamJulesHandler = HttpApiBuilder.group(Api, "server.teamjules", (handlers) =>
  handlers
    .handle(
      "teamjules.list",
      Effect.fn(function* (ctx) {
        const service = yield* TeamJules.Service
        return yield* service.listTasks({
          status: ctx.query.status as any,
          repo: ctx.query.repo,
          limit: ctx.query.limit,
        })
      }),
    )
    .handle(
      "teamjules.create",
      Effect.fn(function* (ctx) {
        const service = yield* TeamJules.Service
        return yield* service.createTask(ctx.payload)
      }),
    )
    .handle(
      "teamjules.get",
      Effect.fn(function* (ctx) {
        const service = yield* TeamJules.Service
        const task = yield* service.getTask(ctx.params.taskID as TeamJules.TaskID)
        if (!task) {
          return yield* new TeamJulesNotFoundError({
            taskID: ctx.params.taskID as string,
            message: `Task not found: ${ctx.params.taskID}`,
          })
        }
        return task
      }),
    )
    .handle(
      "teamjules.cancel",
      Effect.fn(function* (ctx) {
        const service = yield* TeamJules.Service
        yield* service.cancelTask(ctx.params.taskID as TeamJules.TaskID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "teamjules.retry",
      Effect.fn(function* (ctx) {
        const service = yield* TeamJules.Service
        yield* service.retryTask(ctx.params.taskID as TeamJules.TaskID)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
