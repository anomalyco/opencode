import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Effect } from "effect"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { Config } from "../config/config"
import { Permission } from "@/permission"

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
  "task",
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service

    const list = Effect.fn("TaskTool.list")(function* (caller?: Tool.InitContext["agent"]) {
      const items = yield* agent.list().pipe(Effect.map((items) => items.filter((item) => item.mode !== "primary")))
      const filtered = caller
        ? items.filter((item) => Permission.evaluate("task", item.name, caller.permission).action !== "deny")
        : items
      return filtered.toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const desc = Effect.fn("TaskTool.desc")(function* (caller?: Tool.InitContext["agent"]) {
      const items = yield* list(caller)
      return DESCRIPTION.replace(
        "{agents}",
        items
          .map(
            (item) =>
              `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
          )
          .join("\n"),
      )
    })

    const run = Effect.fn("TaskTool.execute")(function* (params: z.infer<typeof parameters>, ctx: Tool.Context) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* Effect.promise(() =>
          ctx.ask({
            permission: "task",
            patterns: [params.subagent_type],
            always: ["*"],
            metadata: {
              description: params.description,
              subagent_type: params.subagent_type,
            },
          }),
        )
      }

      const next = yield* agent.get(params.subagent_type).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const hasTask = next.permission.some((rule) => rule.permission === "task")
      const hasTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const session = yield* Effect.promise(() =>
        iife(async () => {
          if (params.task_id) {
            const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
            if (found) return found
          }

          return Session.create({
            parentID: ctx.sessionID,
            title: params.description + ` (@${next.name} subagent)`,
            permission: [
              ...(hasTodo
                ? []
                : [
                    {
                      permission: "todowrite" as const,
                      pattern: "*" as const,
                      action: "deny" as const,
                    },
                  ]),
              ...(hasTask
                ? []
                : [
                    {
                      permission: "task" as const,
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
          })
        }),
      )

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
      })

      const messageID = MessageID.ascending()

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () => Effect.promise(() => SessionPrompt.resolvePromptParts(params.prompt)),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      ).pipe(
        Effect.flatMap((parts) =>
          Effect.promise(() =>
            SessionPrompt.prompt({
              messageID,
              sessionID: session.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              agent: next.name,
              tools: {
                ...(hasTodo ? {} : { todowrite: false }),
                ...(hasTask ? {} : { task: false }),
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
              },
              parts,
            }),
          ),
        ),
        Effect.map((result) => {
          const text = result.parts.findLast((item) => item.type === "text")?.text ?? ""
          return {
            title: params.description,
            metadata: {
              sessionId: session.id,
              model,
            },
            output: [
              `task_id: ${session.id} (for resuming to continue this task if needed)`,
              "",
              "<task_result>",
              text,
              "</task_result>",
            ].join("\n"),
          }
        }),
      )
    })

    return async (ctx) => {
      const description = await Effect.runPromise(desc(ctx?.agent))

      return {
        description,
        parameters,
        async execute(params: z.infer<typeof parameters>, ctx) {
          return Effect.runPromise(run(params, ctx))
        },
      }
    }
  }),
)
