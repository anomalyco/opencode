import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect, Schema } from "effect"

const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_TASK_DEFAULT_TIMEOUT_MS || 10 * 60 * 1000

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: `Optional timeout in milliseconds. If the subagent does not complete within this duration the task fails with a timeout error so the calling agent can retry with a larger timeout, narrow the scope, or fall back. Defaults to ${DEFAULT_TIMEOUT}ms when not specified.`,
  }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
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
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
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

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const messageID = MessageID.ascending()

      function cancel() {
        ops.cancel(nextSession.id)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          Effect.gen(function* () {
            const timeout = params.timeout ?? DEFAULT_TIMEOUT
            if (timeout < 0) {
              return yield* Effect.fail(
                new Error(`Invalid timeout value: ${timeout}. Timeout must be a positive number of milliseconds.`),
              )
            }
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const outcome = yield* Effect.raceAll([
              ops
                .prompt({
                  messageID,
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
                .pipe(Effect.map((result) => ({ kind: "ok" as const, result }))),
              Effect.sleep(`${timeout} millis`).pipe(Effect.map(() => ({ kind: "timeout" as const }))),
            ])

            if (outcome.kind === "timeout") {
              cancel()
              return {
                title: params.description,
                metadata: {
                  sessionId: nextSession.id,
                  model,
                },
                output: [
                  `task_id: ${nextSession.id} (for resuming if the timeout was premature)`,
                  "",
                  "<task_error>",
                  `Subagent "${params.subagent_type}" did not complete within ${timeout}ms and was cancelled.`,
                  `If this task legitimately needs more time, retry with a larger 'timeout' value (in milliseconds) or narrow the task scope.`,
                  `If the subagent appears stalled (provider or network hang), do not retry indefinitely; report what you have to the user.`,
                  "</task_error>",
                ].join("\n"),
              }
            }

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                outcome.result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
              ].join("\n"),
            }
          }),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
