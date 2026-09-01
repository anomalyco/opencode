import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import type { SessionID } from "../session/schema"

export const Parameters = Schema.Struct({
  task_id: Schema.String.annotate({
    description: "The session ID of the subagent to manage",
  }),
  action: Schema.Literals(["list", "status", "cancel"]).annotate({
    description:
      "Action to perform: 'list' shows all running tasks, 'status' shows details of a specific task, 'cancel' aborts a running task",
  }),
})

type Metadata = {
  tasks?: Array<{
    id: string
    title?: string
    status: string
    parentSessionId?: string
  }>
}

export const ManageSubagentTool = Tool.define<typeof Parameters, Metadata, BackgroundJob.Service>(
  "manage_subagent",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service

    return {
      description: "Manage running subagent tasks. Use 'list' to see all active tasks, 'status' to check a specific task, or 'cancel' to abort a running task.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "manage_subagent",
            patterns: [params.action],
            always: [params.action],
            metadata: { task_id: params.task_id, action: params.action },
          })

          if (params.action === "list") {
            const jobs = yield* background.list()
            const tasks = jobs
              .filter((job) => job.type === "task" && job.status === "running")
              .map((job) => ({
                id: job.id,
                title: job.title,
                status: job.status,
                parentSessionId: job.metadata?.parentSessionId as string | undefined,
              }))

            const lines = ["Running tasks (" + tasks.length + "):"]
            for (const t of tasks) {
              lines.push("  - " + t.id + ": " + (t.title ?? "untitled") + " (parent: " + (t.parentSessionId ?? "none") + ")")
            }

            return {
              title: tasks.length + " running",
              output: tasks.length === 0 ? "No running subagent tasks." : lines.join("\n"),
              metadata: { tasks },
            }
          }

          if (params.action === "status") {
            const job = yield* background.get(params.task_id)
            if (!job) {
              return {
                title: "Task not found",
                output: "No task found with ID: " + params.task_id,
                metadata: {},
              }
            }

            const lines = [
              "Task: " + (job.title ?? "untitled"),
              "Status: " + job.status,
              "Started: " + new Date(job.started_at).toISOString(),
            ]
            if (job.completed_at) lines.push("Completed: " + new Date(job.completed_at).toISOString())
            if (job.output) lines.push("Output: " + job.output.slice(0, 500))
            if (job.error) lines.push("Error: " + job.error)

            return {
              title: job.status,
              output: lines.join("\n"),
              metadata: {},
            }
          }

          if (params.action === "cancel") {
            const cancelled = yield* background.cancel(params.task_id)
            if (!cancelled) {
              return {
                title: "Cancel failed",
                output: "No running task found with ID: " + params.task_id,
                metadata: {},
              }
            }

            return {
              title: "Task cancelled",
              output: "Successfully cancelled task: " + params.task_id,
              metadata: {},
            }
          }

          return {
            title: "Unknown action",
            output: "Unknown action: " + params.action,
            metadata: {},
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
