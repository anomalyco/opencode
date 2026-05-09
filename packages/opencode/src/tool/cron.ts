import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { SchedulerStore } from "@/scheduler/store"
import { SchedulerRunner } from "@/scheduler/runner"
import { Provider } from "@/provider/provider"

const Parameters = Schema.Struct({
  action: Schema.Literals(["add", "list", "remove"]),
  id: Schema.optional(Schema.String),
  schedule: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
})

type Metadata = {
  count: number
  id: string
}

export const CronTool = Tool.define<typeof Parameters, Metadata, never>(
  "cron",
  Effect.succeed({
    description: "Manage scheduler jobs by adding, listing, or removing cron prompts.",
    parameters: Parameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "cron",
          patterns: ["*"],
          always: ["*"],
          metadata: {},
        })

        if (params.action === "list") {
          const jobs = yield* Effect.promise(() => SchedulerStore.list())
          return {
            title: `${jobs.length} jobs`,
            output: JSON.stringify(jobs, null, 2),
            metadata: { count: jobs.length, id: "" },
          }
        }

        if (params.action === "remove") {
          const id = params.id
          if (!id) throw new Error("id is required for remove")
          const ok = yield* Effect.promise(() => SchedulerStore.remove(id))
          if (!ok) throw new Error(`cron job not found: ${id}`)
          SchedulerRunner.notify()
          return {
            title: "removed",
            output: `Removed cron job ${id}`,
            metadata: { id, count: 0 },
          }
        }

        const schedule = params.schedule
        if (!schedule) throw new Error("schedule is required for add")
        const prompt = params.prompt
        if (!prompt) throw new Error("prompt is required for add")

        const job = yield* Effect.promise(() =>
          SchedulerStore.add({
            schedule,
            prompt,
            enabled: params.enabled ?? true,
            agent: params.agent,
            model: params.model ? Provider.parseModel(params.model) : undefined,
            variant: params.variant,
          }),
        )
        SchedulerRunner.notify()

        return {
          title: job.id,
          output: JSON.stringify(job, null, 2),
          metadata: { id: job.id, count: 0 },
        }
      }),
  }),
)
