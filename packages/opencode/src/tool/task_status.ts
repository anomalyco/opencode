import * as Tool from "./tool"
import DESCRIPTION from "./task_status.txt"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { SessionStatus } from "@/session/status"
import { PositiveInt } from "@/util/schema"
import { Effect, Option, Schema } from "effect"
import { BackgroundJob } from "@/background/job"

const DEFAULT_TIMEOUT = 60_000
const POLL_MS = 300

const Parameters = Schema.Struct({
  task_id: SessionID.annotate({ description: "The task_id returned by the task tool" }),
  wait: Schema.optional(Schema.Boolean).annotate({ description: "When true, wait until the task reaches a terminal state or timeout" }),
  timeout_ms: Schema.optional(PositiveInt).annotate({
    description: "Maximum milliseconds to wait when wait=true (default: 60000)",
  }),
})

type State = "running" | "completed" | "error"
type InspectResult = { state: State; text: string }

function format(input: { taskID: SessionID; state: State; text: string }) {
  return [`task_id: ${input.taskID}`, `state: ${input.state}`, "", "<task_result>", input.text, "</task_result>"].join(
    "\n",
  )
}

function errorText(error: NonNullable<MessageV2.Assistant["error"]>) {
  const data = Reflect.get(error, "data")
  const message = data && typeof data === "object" ? Reflect.get(data, "message") : undefined
  if (typeof message === "string" && message) return message
  return error.name
}

function jobResult(job: BackgroundJob.Info): InspectResult {
  if (job.status === "running") {
    return {
      state: "running",
      text: "Task is still running.",
    }
  }
  if (job.status === "completed") {
    return {
      state: "completed",
      text: job.output ?? "",
    }
  }
  return {
    state: "error",
    text: job.error ?? `Task ${job.status}.`,
  }
}

export const TaskStatusTool = Tool.define(
  "task_status",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const jobs = yield* BackgroundJob.Service

    const inspect: (taskID: SessionID) => Effect.Effect<InspectResult> = Effect.fn("TaskStatusTool.inspect")(function* (
      taskID: SessionID,
    ) {
      const current = yield* status.get(taskID)
      if (current.type === "busy" || current.type === "retry") {
        return {
          state: "running" as const,
          text: current.type === "retry" ? `Task is retrying: ${current.message}` : "Task is still running.",
        }
      }

      const latestAssistant = yield* sessions.findMessage(taskID, (item) => item.info.role === "assistant")
      if (Option.isNone(latestAssistant)) {
        return {
          state: "running" as const,
          text: "Task has started but has not produced output yet.",
        }
      }
      if (latestAssistant.value.info.role !== "assistant") {
        return {
          state: "running" as const,
          text: "Task has started but has not produced output yet.",
        }
      }

      const latestUser = yield* sessions.findMessage(taskID, (item) => item.info.role === "user")
      if (
        Option.isSome(latestUser) &&
        latestUser.value.info.role === "user" &&
        latestUser.value.info.id > latestAssistant.value.info.id
      ) {
        return {
          state: "running" as const,
          text: "Task is starting.",
        }
      }

      const text = latestAssistant.value.parts.findLast((part) => part.type === "text")?.text ?? ""
      if (latestAssistant.value.info.error) {
        return {
          state: "error" as const,
          text: text || errorText(latestAssistant.value.info.error),
        }
      }

      const done =
        !!latestAssistant.value.info.finish && !["tool-calls", "unknown"].includes(latestAssistant.value.info.finish)
      if (done) {
        return {
          state: "completed" as const,
          text,
        }
      }

      return {
        state: "running" as const,
        text: text || "Task is still running.",
      }
    })

    const waitForTerminal: (
      taskID: SessionID,
      timeout: number,
    ) => Effect.Effect<{ result: InspectResult; timedOut: boolean }> = Effect.fn(
      "TaskStatusTool.waitForTerminal",
    )(function* (taskID: SessionID, timeout: number) {
        const result = yield* inspect(taskID)
        if (result.state !== "running") return { result, timedOut: false }
        if (timeout <= 0) return { result, timedOut: true }
        const sleep = Math.min(POLL_MS, timeout)
        yield* Effect.sleep(sleep)
        return yield* waitForTerminal(taskID, timeout - sleep)
      })

    const run = Effect.fn(
      "TaskStatusTool.execute",
    )(function* (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) {
      yield* sessions.get(params.task_id)

      const job = yield* jobs.get(params.task_id)
      const waitedJob =
        job && params.wait === true
          ? yield* jobs.wait({ id: params.task_id, timeout: params.timeout_ms ?? DEFAULT_TIMEOUT })
          : { info: job, timedOut: false }
      if (waitedJob.info) {
        const result = jobResult(waitedJob.info)
        return {
          title: "Task status",
          metadata: {
            task_id: params.task_id,
            state: result.state,
            timed_out: waitedJob.timedOut,
          },
          output: format({
            taskID: params.task_id,
            state: result.state,
            text: waitedJob.timedOut
              ? `Timed out after ${params.timeout_ms ?? DEFAULT_TIMEOUT}ms while waiting for task completion.`
              : result.text,
          }),
        }
      }

      const waited =
        params.wait === true
          ? yield* waitForTerminal(params.task_id, params.timeout_ms ?? DEFAULT_TIMEOUT)
          : { result: yield* inspect(params.task_id), timedOut: false }

      const outputText = waited.timedOut
        ? `Timed out after ${params.timeout_ms ?? DEFAULT_TIMEOUT}ms while waiting for task completion.`
        : waited.result.text

      return {
        title: "Task status",
        metadata: {
          task_id: params.task_id,
          state: waited.result.state,
          timed_out: waited.timedOut,
        },
        output: format({
          taskID: params.task_id,
          state: waited.result.state,
          text: outputText,
        }),
      }
    }, Effect.orDie)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: run,
    }
  }),
)
