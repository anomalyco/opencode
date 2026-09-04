import { Effect, Schema } from "effect"
import { BackgroundJob } from "@/background/job"
import { ShellID } from "./shell/id"
import * as Tool from "./tool"

const DESCRIPTION = `List, inspect, and cancel shell commands that were started with run_in_background=true.

Actions:
- list: show all background shell jobs with their id, status, command, and log file path. Use this when you need to recall what is running or find a job id.
- kill: terminate a background command. Requires job_id. Use this to stop a command that is no longer needed, stuck, or occupying a port. The command and its whole process group are killed. Do not kill jobs that are about to finish on their own.

Live output is available by Reading or Grepping the job's log file path at any time; completion output is delivered automatically without polling.`

type Parameters = Schema.Schema.Type<typeof Parameters>

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "kill"]).annotate({
    description: "list shows background shell jobs; kill terminates one",
  }),
  job_id: Schema.optional(Schema.String).annotate({
    description: "The job id to act on. Required for kill; obtain it from list or from the original run_in_background result.",
  }),
})

type JobsMetadata = {
  action: string
  count?: number
  jobId?: string
  status?: string
}

function renderList(jobs: BackgroundJob.Info[]) {
  if (jobs.length === 0) return "No background shell jobs."
  const lines = jobs.map((job) => {
    const log = typeof job.metadata?.logPath === "string" ? job.metadata.logPath : undefined
    return `- ${job.id} [${job.status}] ${job.title}${log ? ` (log: ${log})` : ""}`
  })
  return lines.join("\n")
}

export const BashJobsTool = Tool.define(
  "bash_jobs",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Parameters, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<JobsMetadata>> =>
        Effect.gen(function* () {
          if (params.action === "kill") {
            if (!params.job_id) throw new Error("job_id is required when action is 'kill'")
            const info = yield* background.cancel(params.job_id)
            if (!info) {
              return {
                title: `kill ${params.job_id}`,
                metadata: { action: "kill", jobId: params.job_id, status: undefined },
                output: `No background job found with id ${params.job_id}. Use action "list" to see jobs from this session.`,
              }
            }
            return {
              title: `kill ${info.title ?? params.job_id}`,
              metadata: { action: "kill", jobId: params.job_id, status: info.status },
              output:
                info.status === "cancelled"
                  ? `Cancelled background job ${params.job_id}: ${info.title ?? ""}`
                  : `Background job ${params.job_id} already finished with status ${info.status}.`,
            }
          }

          const jobs = (yield* background.list()).filter((job) => job.type === ShellID.ToolID)
          return {
            title: "list background jobs",
            metadata: { action: "list", count: jobs.length },
            output: renderList(jobs),
          }
        }),
    }
  }),
)

export * as BashJobs from "./bash-jobs"
