import { ShellJob } from "@opencode-ai/core/shell-job"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const JobInput = Schema.Struct({
  jobId: Schema.String,
})

const JobWaitInput = Schema.Struct({
  jobId: Schema.String,
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Maximum time to wait in milliseconds. Omit to wait until the job reaches a final state.",
  }),
})

const JobLogsInput = Schema.Struct({
  jobId: Schema.String,
  lines: Schema.optional(PositiveInt).annotate({ description: "Number of recent log lines to return." }),
})

const jobOutput = (job: ShellJob.Snapshot) =>
  [
    `Shell job ${job.jobId}: ${job.status}`,
    `Command: ${job.command}`,
    `cwd: ${job.cwd}`,
    `durationMs: ${job.durationMs}`,
    job.exitCode === undefined ? undefined : `exitCode: ${job.exitCode}`,
    job.error === undefined ? undefined : `error: ${job.error}`,
    "",
    job.outputPreview,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")

const metadata = (job: ShellJob.Snapshot) => ({
  output: job.outputPreview,
  jobId: job.jobId,
  status: job.status,
  exit: job.exitCode,
  background: true,
  truncated: job.stdoutTruncated === true || job.stderrTruncated === true,
})

function missing(jobId: string) {
  return new Error(`Unknown shell job: ${jobId}`)
}

export const ShellStatusTool = Tool.define(
  "shell_status",
  Effect.gen(function* () {
    const shellJob = yield* ShellJob.Service
    return {
      description: "Return status and recent output for a managed background shell job created by bash background=true.",
      parameters: JobInput,
      execute: (params: typeof JobInput.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const job = yield* shellJob.status({ sessionID: ctx.sessionID, jobId: params.jobId })
          if (!job) return yield* Effect.die(missing(params.jobId))
          return {
            title: `Shell job ${job.status}`,
            metadata: metadata(job),
            output: jobOutput(job),
          }
        }),
    }
  }),
)

export const ShellWaitTool = Tool.define(
  "shell_wait",
  Effect.gen(function* () {
    const shellJob = yield* ShellJob.Service
    return {
      description:
        "Wait for a managed background shell job to finish, or return its current snapshot when the optional timeout elapses.",
      parameters: JobWaitInput,
      execute: (params: typeof JobWaitInput.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const job = yield* shellJob.wait({ sessionID: ctx.sessionID, jobId: params.jobId, timeout: params.timeout })
          if (!job) return yield* Effect.die(missing(params.jobId))
          return {
            title: `Shell job ${job.status}`,
            metadata: metadata(job),
            output: jobOutput(job),
          }
        }),
    }
  }),
)

export const ShellCancelTool = Tool.define(
  "shell_cancel",
  Effect.gen(function* () {
    const shellJob = yield* ShellJob.Service
    return {
      description: "Cancel a managed background shell job and kill its process tree.",
      parameters: JobInput,
      execute: (params: typeof JobInput.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const job = yield* shellJob.cancel({ sessionID: ctx.sessionID, jobId: params.jobId })
          if (!job) return yield* Effect.die(missing(params.jobId))
          return {
            title: `Shell job ${job.status}`,
            metadata: metadata(job),
            output: jobOutput(job),
          }
        }),
    }
  }),
)

export const ShellLogsTool = Tool.define(
  "shell_logs",
  Effect.gen(function* () {
    const shellJob = yield* ShellJob.Service
    return {
      description: "Return recent logs for a managed background shell job.",
      parameters: JobLogsInput,
      execute: (params: typeof JobLogsInput.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const logs = yield* shellJob.logs({ sessionID: ctx.sessionID, jobId: params.jobId, lines: params.lines })
          if (logs === undefined) return yield* Effect.die(missing(params.jobId))
          return {
            title: "Shell job logs",
            metadata: {
              output: logs,
              jobId: params.jobId,
              background: true,
              truncated: false,
            },
            output: logs,
          }
        }),
    }
  }),
)
