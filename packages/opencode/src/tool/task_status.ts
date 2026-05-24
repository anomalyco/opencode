import * as Tool from "./tool"
import DESCRIPTION from "./task_status.txt"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { PositiveInt } from "@opencode-ai/core/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Effect, Option, Schema } from "effect"

const DEFAULT_TIMEOUT = 60_000
const POLL_MS = 300

const Parameters = Schema.Struct({
  task_id: SessionID.annotate({ description: "The task_id returned by the task tool" }),
  wait: Schema.optional(Schema.Boolean).annotate({
    description: "When true, wait until the task reaches a terminal state or timeout",
  }),
  timeout_ms: Schema.optional(PositiveInt).annotate({
    description: "Maximum milliseconds to wait when wait=true (default: 60000)",
  }),
})

type State = BackgroundJob.Status
type InspectResult = { state: State; text: string }

function format(input: { taskID: SessionID; state: State; text: string }) {
  const tag = input.state === "completed" || input.state === "running" ? "task_result" : "task_error"
  return [`task_id: ${input.taskID}`, `state: ${input.state}`, "", `<${tag}>`, input.text, `</${tag}>`].join("\n")
}

function errorText(error: NonNullable<MessageV2.Assistant["error"]>) {
  const data = Reflect.get(error, "data")
  const message = data && typeof data === "object" ? Reflect.get(data, "message") : undefined
  if (typeof message === "string" && message) return message
  return error.name
}

function inspectMessage(message: MessageV2.WithParts): InspectResult | undefined {
  if (message.info.role !== "assistant") return
  const text = message.parts.findLast((part) => part.type === "text")?.text ?? ""
  if (message.info.error) return { state: "error", text: text || errorText(message.info.error) }
  if (message.info.finish && !["tool-calls", "unknown"].includes(message.info.finish))
    return { state: "completed", text }
  return { state: "running", text: text || "Task is still running." }
}

export const TaskStatusTool = Tool.define(
  "task_status",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const flags = yield* RuntimeFlags.Service

    const inspect: (taskID: SessionID) => Effect.Effect<InspectResult> = Effect.fn("TaskStatusTool.inspect")(function* (
      taskID: SessionID,
    ) {
      const job = yield* jobs.get(taskID)
      if (job) {
        return {
          state: job.status,
          text:
            job.output ??
            job.error ??
            (job.status === "running"
              ? "Task is still running."
              : job.status === "cancelled"
                ? "Task was cancelled."
                : ""),
        }
      }

      const current = yield* status.get(taskID)
      if (current.type === "busy" || current.type === "retry") {
        return {
          state: "running",
          text: current.type === "retry" ? `Task is retrying: ${current.message}` : "Task is still running.",
        }
      }

      const latestAssistant = yield* sessions
        .findMessage(taskID, (item) => item.info.role === "assistant")
        .pipe(Effect.orDie)
      if (Option.isSome(latestAssistant)) {
        const latest = inspectMessage(latestAssistant.value)
        if (!latest) return { state: "error", text: "Task is not running in this process." }
        if (latest.state === "running")
          return { state: "error", text: "Task is not running in this process and has no final output." }
        return latest
      }
      return { state: "error", text: "Task is not running in this process and has not produced output." }
    })

    const waitForTerminal: (
      taskID: SessionID,
      timeout: number,
    ) => Effect.Effect<{ result: InspectResult; timedOut: boolean }> = Effect.fn("TaskStatusTool.waitForTerminal")(
      function* (taskID: SessionID, timeout: number) {
        const result = yield* inspect(taskID)
        if (result.state !== "running") return { result, timedOut: false }
        if (timeout <= 0) return { result, timedOut: true }
        const sleep = Math.min(POLL_MS, timeout)
        yield* Effect.sleep(`${sleep} millis`)
        return yield* waitForTerminal(taskID, timeout - sleep)
      },
    )

    const run = Effect.fn("TaskStatusTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      _ctx: Tool.Context,
    ) {
      if (!flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(new Error("task_status requires OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"))
      }

      const session = yield* sessions.get(params.task_id).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (!session) {
        return {
          title: "Task status",
          metadata: {
            task_id: params.task_id,
            state: "error" as const,
            timed_out: false,
          },
          output: format({
            taskID: params.task_id,
            state: "error",
            text: `Task not found: ${params.task_id}`,
          }),
        }
      }

      const waited =
        params.wait === true
          ? yield* jobs.wait({ id: params.task_id, timeout: params.timeout_ms ?? DEFAULT_TIMEOUT })
          : { info: yield* jobs.get(params.task_id), timedOut: false }
      const inspected = waited.info
        ? {
            result: {
              state: waited.info.status,
              text:
                waited.info.output ??
                waited.info.error ??
                (waited.info.status === "running" ? "Task is still running." : ""),
            },
            timedOut: waited.timedOut,
          }
        : params.wait === true
          ? yield* waitForTerminal(params.task_id, params.timeout_ms ?? DEFAULT_TIMEOUT)
          : { result: yield* inspect(params.task_id), timedOut: false }
      const text = inspected.timedOut
        ? `Timed out after ${params.timeout_ms ?? DEFAULT_TIMEOUT}ms while waiting for task completion.`
        : inspected.result.text

      return {
        title: "Task status",
        metadata: {
          task_id: params.task_id,
          state: inspected.result.state,
          timed_out: inspected.timedOut,
        },
        output: format({
          taskID: params.task_id,
          state: inspected.result.state,
          text,
        }),
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
