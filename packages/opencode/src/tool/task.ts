import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Config } from "../config/config"
import { Effect } from "effect"
import { Log } from "@/util/log"

const id = "task"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.defineEffect(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service

    const run = Effect.fn("TaskTool.execute")(function* (params: z.infer<typeof parameters>, ctx: Tool.Context) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* Effect.promise(() =>
          ctx.ask({
            permission: id,
            patterns: [params.subagent_type],
            always: ["*"],
            metadata: {
              description: params.description,
              subagent_type: params.subagent_type,
            },
          }),
        )
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* Effect.promise(() => {
            const id = SessionID.make(taskID)
            return Session.get(id).catch(() => undefined)
          })
        : undefined
      const nextSession =
        session ??
        (yield* Effect.promise(() =>
          Session.create({
            parentID: ctx.sessionID,
            title: params.description + ` (@${next.name} subagent)`,
            permission: [
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
          }),
        ))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const messageID = MessageID.ascending()

      function cancel() {
        SessionPrompt.cancel(nextSession.id)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* Effect.promise(() => SessionPrompt.resolvePromptParts(params.prompt))
            const result = yield* Effect.promise(() =>
              SessionPrompt.prompt({
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
              }),
            )

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
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
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
      parameters,
      async execute(params: z.infer<typeof parameters>, ctx) {
        return Effect.runPromise(run(params, ctx))
      },
    }
  }),
)
