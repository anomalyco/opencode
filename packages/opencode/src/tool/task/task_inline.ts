import z from "zod"
import { Effect } from "effect"
import { Agent } from "../../agent/agent"
import { Config } from "../../config/config"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { MessageID, SessionID } from "../../session/schema"
import { SessionPrompt } from "../../session/prompt"
import { Permission } from "@/permission"
import type { Tool } from "../shared/tool"

const id = "task"

export const InlineTaskID = id

export const InlineTaskParameters = z.object({
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

export const describeInlineTask = (agent: Agent.Info) =>
  Effect.gen(function* () {
    const items = yield* Effect.promise(() =>
      Agent.list().then((items) => items.filter((item) => item.mode !== "primary" && !item.hidden)),
    )
    const filtered = items.filter((item) => Permission.evaluate(id, item.name, agent.permission).action !== "deny")
    const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
    const description = list
      .map((item) => `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n")
    return ["Available agent types and the tools they have access to:", description].join("\n")
  })

export async function runInlineTask(
  params: z.infer<typeof InlineTaskParameters>,
  ctx: Tool.Context,
): Promise<{
  title: string
  metadata: {
    sessionId: SessionID
    model: {
      modelID: string
      providerID: string
    }
  }
  output: string
  attachments: any[]
}> {
  return InlineTaskHooks.run(params, ctx)
}

export const InlineTaskHooks = {
  async run(
  params: z.infer<typeof InlineTaskParameters>,
  ctx: Tool.Context,
): Promise<{
  title: string
  metadata: {
    sessionId: SessionID
    model: {
      modelID: string
      providerID: string
    }
  }
  output: string
  attachments: any[]
}> {
  const cfg = await Config.get()

  const bypass =
    ctx.extra?.bypassAgentCheck === true ||
    (Array.isArray(ctx.extra?.userInvokedAgents) && ctx.extra.userInvokedAgents.includes(params.subagent_type))

  if (!bypass) {
    await ctx.ask({
      permission: id,
      patterns: [params.subagent_type],
      always: ["*"],
      metadata: {
        description: params.description,
        subagent_type: params.subagent_type,
      },
    })
  }

  const next = await Agent.get(params.subagent_type)
  if (!next || next.hidden) {
    throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)
  }

  const canTask = next.permission.some((rule) => rule.permission === id)
  const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

  const taskID = params.task_id
  const session = taskID
    ? await Session.get(SessionID.make(taskID)).catch(() => undefined)
    : undefined
  const nextSession =
    session ??
    (await Session.create({
      parentID: ctx.sessionID,
      title: params.description + ` (@${next.name} subagent)`,
      permission: [
        ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(canTask ? [] : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((item: string) => ({
          pattern: "*",
          action: "allow" as const,
          permission: item,
        })) ?? []),
      ],
    }))

  const msg = MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
  if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

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

  return Effect.runPromise(
    Effect.acquireUseRelease(
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
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item: string) => [item, false])),
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
            attachments: [],
          }
        }),
      () =>
        Effect.sync(() => {
          ctx.abort.removeEventListener("abort", cancel)
        }),
    ),
  )
  },
}
