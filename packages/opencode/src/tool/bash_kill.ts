import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { BackgroundJob } from "@/background/job"

const Parameters = Schema.Struct({
  job_id: Schema.String.annotate({ description: "The background bash job id to cancel" }),
})

type Metadata = {
  jobId: string
  status?: BackgroundJob.Status
  truncated: boolean
}

export const BashKillTool = Tool.define(
  "bash_kill",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service

    return {
      description: "Cancel a running background bash command by job id.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const existing = yield* background.get(params.job_id)
          if (existing && existing.type !== "bash") {
            return {
              title: "Background bash job not found",
              metadata: { jobId: params.job_id, truncated: false } as Metadata,
              output: `No background bash job found with id ${params.job_id}.`,
            }
          }
          const info = existing ? yield* background.cancel(params.job_id) : undefined
          if (!info) {
            return {
              title: "Background bash job not found",
              metadata: { jobId: params.job_id, truncated: false } as Metadata,
              output: `No background bash job found with id ${params.job_id}.`,
            }
          }
          return {
            title: `Cancelled ${params.job_id}`,
            metadata: {
              jobId: info.id,
              status: info.status,
              truncated: false,
            } as Metadata,
            output: `Background bash job ${info.id} is ${info.status}.`,
          }
        }),
    }
  }),
)
