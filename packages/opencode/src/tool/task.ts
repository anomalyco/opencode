import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { Effect } from "effect"

export const TaskTool = Tool.define("task", async () => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
  const list = agents.toSorted((a, b) => a.name.localeCompare(b.name))
  const agentList = list
    .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
    .join("\n")
  const description = [`Available agent types and the tools they have access to:`, agentList].join("\n")

  return {
    description,
    parameters: z.object({
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
    }),
    async execute(params, ctx) {
      const config = await Config.get()
      const caller = await Agent.get(ctx.agent)

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

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)
      if (!caller) throw new Error(`Unknown agent type: ${ctx.agent}`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
      const parent = await Session.get(ctx.sessionID)
      const rules = Permission.merge(caller.permission, parent.permission ?? [])
      const perm = [
        {
          permission: "todowrite" as const,
          pattern: "*" as const,
          action: "deny" as const,
        },
        {
          permission: "todoread" as const,
          pattern: "*" as const,
          action: "deny" as const,
        },
        ...(hasTaskPermission
          ? []
          : [
              {
                permission: "task" as const,
                pattern: "*" as const,
                action: "deny" as const,
              },
            ]),
        ...(Permission.evaluate("edit", "*", rules).action === "deny"
          ? [
              {
                permission: "edit" as const,
                pattern: "*" as const,
                action: "deny" as const,
              },
            ]
          : []),
      ]

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            ...perm,
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const curr = session.permission ?? []
      const next = [
        ...curr.filter(
          (item) => !perm.some((rule) => rule.permission === item.permission && rule.pattern === item.pattern),
        ),
        ...perm,
      ]
      const same =
        next.length === curr.length &&
        next.every(
          (rule, i) =>
            rule.permission === curr[i]?.permission &&
            rule.pattern === curr[i]?.pattern &&
            rule.action === curr[i]?.action,
        )
      if (!same) {
        session.permission = next
        await Session.setPermission({
          sessionID: session.id,
          permission: next,
        })
      }
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

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

export const TaskDescription: Tool.DynamicDescription = (agent) =>
  Effect.gen(function* () {
    const items = yield* Effect.promise(() =>
      Agent.list().then((items) => items.filter((item) => item.mode !== "primary")),
    )
    const filtered = items.filter((item) => Permission.evaluate(id, item.name, agent.permission).action !== "deny")
    const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
    const description = list
      .map(
        (item) => `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
      )
      .join("\n")
    return ["Available agent types and the tools they have access to:", description].join("\n")
  })
