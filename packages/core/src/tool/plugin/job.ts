export * as JobTools from "./job.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { NonNegativeInt, optional } from "@opencode/schema/schema"
import { Effect, Schema } from "effect"
import { CodeModeTool } from "../../codemode/tool.js"
import { Job } from "../../job.js"
import { Session } from "../../session.js"
import { Tool } from "../../tool.js"

const JobEntry = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  title: optional(Schema.String),
  status: Job.Status,
  started_at: NonNegativeInt,
  completed_at: optional(NonNegativeInt),
  output: optional(Schema.String),
  error: optional(Schema.String),
})

type JobEntry = typeof JobEntry.Type

export const ListInput = Schema.Struct({
  status: Schema.optionalKey(Schema.Literals(["running", "all"])).annotate({
    description: 'Which jobs to list. Defaults to "running".',
  }),
})

const ListOutput = Schema.Struct({
  jobs: Schema.Array(JobEntry),
})

export const IDInput = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Job ID returned when a tool moved to the background (shellID, sessionID, or jobID).",
  }),
})

export const WaitInput = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Job ID to wait for.",
  }),
  yield_after: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Maximum milliseconds to wait before returning the job's current status and output so far. Defaults to ${Job.DEFAULT_YIELD_AFTER_MS}.`,
  }),
})

const WaitOutput = Schema.Struct({
  job: JobEntry,
  timedOut: Schema.Boolean,
})

function toEntry(info: Job.Info): JobEntry {
  return {
    id: info.id,
    type: info.type,
    ...(info.title !== undefined ? { title: info.title } : {}),
    status: info.status,
    started_at: info.started_at,
    ...(info.completed_at !== undefined ? { completed_at: info.completed_at } : {}),
    ...(info.output !== undefined ? { output: info.output } : {}),
    ...(info.error !== undefined ? { error: info.error } : {}),
  }
}

function renderEntry(entry: JobEntry, timedOut?: boolean) {
  const header = `[${entry.status}${timedOut ? ", timed out waiting" : ""}] ${entry.type} (${entry.id})${entry.title ? `: ${entry.title}` : ""}`
  const detail = entry.status === "error" ? entry.error : entry.output
  return detail ? `${header}\n\n${detail}` : header
}

export const Plugin = {
  id: "opencode.tool.job",
  effect: Effect.fn("JobTools.Plugin")(function* (ctx: Context) {
    const jobs = yield* Job.Service
    const sessions = yield* Session.Service
    const tools = yield* Tool.Service
    CodeModeTool.bind(tools, { jobs, sessions })

    const requireOwned = Effect.fn("JobTools.requireOwned")(function* (id: string, sessionID: Session.ID) {
      const info = yield* jobs.read(id)
      if (!info || (info.sessionID !== undefined && info.sessionID !== sessionID))
        return yield* new ToolFailure({ message: `Job not found: ${id}` })
      return info
    })

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "job_list",
          description: "List background or running jobs started by the current session.",
          input: ListInput,
          output: ListOutput,
          options: { namespace: "opencode", codemode: true, pinned: true },
          execute: (input, context) =>
            jobs
              .list({
                sessionID: context.sessionID,
                running: (input.status ?? "running") === "running",
              })
              .pipe(
                Effect.map((items) => {
                  const entries = items.map(toEntry)
                  return {
                    output: { jobs: entries },
                    content: entries.length === 0 ? "No matching jobs." : entries.map((item) => renderEntry(item)).join("\n\n"),
                  }
                }),
              ),
        })
        editor.add({
          name: "job_output",
          description: "Read a job's current status and output (output so far while running, or final output once settled).",
          input: IDInput,
          output: JobEntry,
          options: { namespace: "opencode", codemode: true, pinned: true },
          execute: (input, context) =>
            requireOwned(input.id, context.sessionID).pipe(
              Effect.map((info) => {
                const entry = toEntry(info)
                return { output: entry, content: renderEntry(entry) }
              }),
            ),
        })
        editor.add({
          name: "job_wait",
          description: "Wait for a job to settle up to yield_after milliseconds, returning its status and output.",
          input: WaitInput,
          output: WaitOutput,
          options: { namespace: "opencode", codemode: true, pinned: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* requireOwned(input.id, context.sessionID)
              const result = yield* jobs.wait({
                id: input.id,
                timeout: input.yield_after ?? Job.DEFAULT_YIELD_AFTER_MS,
              })
              if (!result.info) return yield* new ToolFailure({ message: `Job not found: ${input.id}` })
              const entry = toEntry(result.info)
              return {
                output: { job: entry, timedOut: result.timedOut },
                content: renderEntry(entry, result.timedOut),
              }
            }),
        })
        editor.add({
          name: "job_stop",
          description: "Stop a running job and return its status and output captured so far.",
          input: IDInput,
          output: JobEntry,
          options: { namespace: "opencode", codemode: true, pinned: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              const current = yield* requireOwned(input.id, context.sessionID)
              const stopped = (yield* jobs.cancel(input.id)) ?? current
              const entry = toEntry(stopped)
              return { output: entry, content: renderEntry(entry) }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
}
