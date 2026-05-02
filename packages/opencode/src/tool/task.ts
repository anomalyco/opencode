import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Bus } from "@/bus"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { SessionStatus } from "@/session/status"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Cause, Effect, Option, Schema } from "effect"
import { Config } from "@/config/config"
import { BackgroundJob } from "@/background/job"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
  loop(input: SessionPrompt.LoopInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(SessionID).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
  background: Schema.optional(Schema.Boolean).annotate({
    description: "When true, launch the subagent in the background and return immediately",
  }),
})

function output(sessionID: SessionID, text: string) {
  return [
    `task_id: ${sessionID} (for resuming to continue this task if needed)`,
    "",
    "<task_result>",
    text,
    "</task_result>",
  ].join("\n")
}

function backgroundOutput(sessionID: SessionID) {
  return [
    `task_id: ${sessionID} (for polling this task with task_status)`,
    "state: running",
    "",
    "<task_result>",
    "Background task started. Continue your current work and call task_status when you need the result.",
    "</task_result>",
  ].join("\n")
}

function backgroundMessage(input: { sessionID: SessionID; description: string; state: "completed" | "error"; text: string }) {
  const tag = input.state === "completed" ? "task_result" : "task_error"
  const title =
    input.state === "completed"
      ? `Background task completed: ${input.description}`
      : `Background task failed: ${input.description}`
  return [title, `task_id: ${input.sessionID}`, `state: ${input.state}`, `<${tag}>`, input.text, `</${tag}>`].join(
    "\n",
  )
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const jobs = yield* BackgroundJob.Service

    const run = Effect.fn(
      "TaskTool.execute",
    )(function* (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(taskID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(parent.permission ?? []).filter(
              (rule) => rule.permission === "external_directory" || rule.action === "deny",
            ),
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const parentModel = {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const background = params.background === true

      const metadata = {
        sessionId: nextSession.id,
        model,
        ...(background ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: next.name,
          tools: {
            ...(canTodo ? {} : { todowrite: false }),
            ...(canTask ? {} : { task: false }),
            ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
          },
          parts,
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      const continueIfIdle = Effect.fn("TaskTool.continueIfIdle")(function* (input: {
        userID: MessageID
        state: "completed" | "error"
      }) {
        if ((yield* status.get(ctx.sessionID)).type !== "idle") return
        const latest = yield* sessions.findMessage(ctx.sessionID, (item) => item.info.role === "user")
        if (Option.isNone(latest)) return
        if (latest.value.info.id !== input.userID) return
        yield* bus.publish(TuiEvent.ToastShow, {
          title: input.state === "completed" ? "Background task complete" : "Background task failed",
          message:
            input.state === "completed"
              ? `Background task \"${params.description}\" finished. Resuming the main thread.`
              : `Background task \"${params.description}\" failed. Resuming the main thread.`,
          variant: input.state === "completed" ? "success" : "error",
          duration: 5000,
        })
        yield* ops.loop({ sessionID: ctx.sessionID }).pipe(Effect.ignore)
      })

      if (background) {
        const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (state: "completed" | "error", text: string) {
          const message = yield* ops.prompt({
            sessionID: ctx.sessionID,
            noReply: true,
            model: parentModel,
            agent: ctx.agent,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: backgroundMessage({
                  sessionID: nextSession.id,
                  description: params.description,
                  state,
                  text,
                }),
              },
            ],
          })
          yield* continueIfIdle({ userID: message.info.id, state })
        })

        yield* jobs.start({
          id: nextSession.id,
          type: id,
          title: params.description,
          metadata: {
            parentSessionID: ctx.sessionID,
            sessionID: nextSession.id,
            subagent: next.name,
          },
          run: runTask().pipe(
            Effect.matchCauseEffect({
              onSuccess: (text) => inject("completed", text).pipe(Effect.as(text)),
              onFailure: (cause) => {
                const text = errorText(Cause.squash(cause))
                return inject("error", text).pipe(
                  Effect.catchCause(() => Effect.void),
                  Effect.andThen(Effect.failCause(cause)),
                )
              },
            }),
          ),
        })

        return {
          title: params.description,
          metadata,
          output: backgroundOutput(nextSession.id),
        }
      }

      function cancel() {
        ops.cancel(nextSession.id)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          Effect.gen(function* () {
            const text = yield* runTask()
            return {
              title: params.description,
              metadata,
              output: output(nextSession.id, text),
            }
          }),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    }, Effect.orDie)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: run,
    }
  }),
)
