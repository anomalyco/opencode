export * as CronTool from "./cron"

import { Effect, Layer, Schema } from "effect"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"
import { makeLocationNode } from "../effect/app-node"
import { CronService } from "../cron/service"
import { CronNode } from "../cron/node"
import { CronJob } from "../cron/job"
import { parseDuration } from "../cron/duration"

const AddInput = Schema.Struct({
  interval: Schema.String.annotate({
    description: "Duration like 5m, 1h, 2h30m, 90s. Minimum 1m.",
  }),
  prompt: Schema.String.annotate({
    description: "The prompt to re-run on this schedule.",
  }),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})
const AddOutput = Schema.Struct({
  id: Schema.String,
  nextRunAt: Schema.Number,
  expiresAt: Schema.Number,
})

const ListOutput = Schema.Struct({ jobs: Schema.Array(CronJob) })

const DeleteInput = Schema.Struct({
  id: Schema.String.annotate({ description: 'Job id, or "all".' }),
})
const DeleteOutput = Schema.Struct({ removed: Schema.Number })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const cron = yield* CronService

    yield* tools
      .register({
        cron_add: Tool.make({
          description: "Schedule a prompt to re-run on a recurring interval in this session.",
          input: AddInput,
          output: AddOutput,
          execute: (input, context) =>
            Effect.gen(function* () {
              const intervalMs = yield* parseDuration(input.interval)
              const job = yield* cron.add({
                sessionID: context.sessionID,
                prompt: input.prompt,
                intervalMs,
                agent: input.agent,
                model: input.model,
              })
              return { id: job.id, nextRunAt: job.nextRunAt, expiresAt: job.expiresAt }
            }).pipe(Effect.mapError((e) => new Tool.Failure({ message: e.message }))),
        }),
        cron_list: Tool.make({
          description: "List scheduled cron jobs for this session.",
          input: Schema.Struct({}),
          output: ListOutput,
          execute: (_input, context) =>
            Effect.map(cron.list(context.sessionID), (jobs) => ({ jobs })),
        }),
        cron_delete: Tool.make({
          description: 'Cancel a scheduled cron job (or "all") for this session.',
          input: DeleteInput,
          output: DeleteOutput,
          execute: (input, context) =>
            Effect.map(cron.remove(context.sessionID, input.id), (removed) => ({ removed })),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/cron",
  layer,
  deps: [ToolRegistry.node, CronNode.node],
})
