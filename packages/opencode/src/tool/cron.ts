import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { CronService } from "@opencode-ai/core/cron/service"
import { parseDuration } from "@opencode-ai/core/cron/duration"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"

const AddParameters = Schema.Struct({
  interval: Schema.String.annotate({
    description: "Duration like 5m, 1h, 2h30m, 90s. Minimum 1m.",
  }),
  prompt: Schema.String.annotate({
    description: "The prompt to re-run on this schedule.",
  }),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})

const ListParameters = Schema.Struct({})

const DeleteParameters = Schema.Struct({
  id: Schema.String.annotate({ description: 'Job id, or "all".' }),
})

type Metadata = { [key: string]: any }

const renderError = (e: unknown) =>
  Effect.succeed({
    title: "cron error",
    output: JSON.stringify({ error: String(e) }),
    metadata: {},
  } satisfies Tool.ExecuteResult)

export const CronAddTool = Tool.define<typeof AddParameters, Metadata, never>(
  "cron_add",
  Effect.gen(function* () {
    return {
      description: "Schedule a prompt to re-run on a recurring interval in this session.",
      parameters: AddParameters,
      execute: ((params, _ctx) =>
        Effect.gen(function* () {
          const cron = yield* CronService
          const intervalMs = yield* parseDuration(params.interval)
          const context = yield* Effect.gen(function* () {
            return { instance: yield* InstanceRef, workspace: yield* WorkspaceRef }
          })
          const job = yield* cron.add({
            sessionID: _ctx.sessionID,
            prompt: params.prompt,
            intervalMs,
            agent: params.agent,
            model: params.model,
            context,
          })
          return {
            title: `cron: every ${params.interval}`,
            output: JSON.stringify(job),
            metadata: {},
          }
        }).pipe(Effect.catch(renderError))) as (params: any, ctx: any) => any,
    } satisfies Tool.DefWithoutID<typeof AddParameters, Metadata>
  }),
)

export const CronListTool = Tool.define<typeof ListParameters, Metadata, never>(
  "cron_list",
  Effect.gen(function* () {
    return {
      description: "List scheduled cron jobs for this session.",
      parameters: ListParameters,
      execute: ((_params, ctx) =>
        Effect.gen(function* () {
          const cron = yield* CronService
          const jobs = yield* cron.list(ctx.sessionID)
          return {
            title: `${jobs.length} cron job(s)`,
            output: JSON.stringify(jobs),
            metadata: {},
          }
        }).pipe(Effect.catch(renderError))) as (params: any, ctx: any) => any,
    } satisfies Tool.DefWithoutID<typeof ListParameters, Metadata>
  }),
)

export const CronDeleteTool = Tool.define<typeof DeleteParameters, Metadata, never>(
  "cron_delete",
  Effect.gen(function* () {
    return {
      description: 'Cancel a scheduled cron job (or "all") for this session.',
      parameters: DeleteParameters,
      execute: ((params, ctx) =>
        Effect.gen(function* () {
          const cron = yield* CronService
          const removed = yield* cron.remove(ctx.sessionID, params.id)
          return {
            title: `removed ${removed} job(s)`,
            output: JSON.stringify({ removed }),
            metadata: {},
          }
        }).pipe(Effect.catch(renderError))) as (params: any, ctx: any) => any,
    } satisfies Tool.DefWithoutID<typeof DeleteParameters, Metadata>
  }),
)
