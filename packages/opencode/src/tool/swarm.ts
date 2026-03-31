import { Tool } from "./tool"
import DESCRIPTION from "./swarm.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID, PartID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { errorMessage } from "../util/error"

const parameters = z.object({
  tasks: z
    .array(
      z.object({
        description: z.string().describe("A short (3-5 words) description of the task"),
        prompt: z.string().describe("The task for the sub-agent to perform"),
        subagent_type: z.string().describe("The type of specialized agent to use for this task"),
      }),
    )
    .min(1, "Provide at least one task")
    .max(10, "Maximum 10 tasks allowed in a single swarm call")
    .describe("Array of independent tasks to execute in parallel across multiple sub-agents"),
})

type SwarmTask = z.infer<typeof parameters>["tasks"][number]

type SwarmResult =
  | {
      success: true
      description: string
      output: string
      sessionId: string
    }
  | {
      success: false
      description: string
      error: string
    }

async function executeTask(
  task: SwarmTask,
  parentSessionID: SessionID,
  parentMessageID: MessageID,
  agentInfo: Agent.Info,
  ctx: Tool.Context,
): Promise<SwarmResult> {
  const config = await Config.get()
  const hasTaskPermission = agentInfo.permission.some((rule) => rule.permission === "task")
  const hasTodoWritePermission = agentInfo.permission.some((rule) => rule.permission === "todowrite")

  const session = await Session.create({
    parentID: parentSessionID,
    title: task.description + ` (@${agentInfo.name} subagent)`,
    permission: [
      ...(hasTodoWritePermission
        ? []
        : [
            {
              permission: "todowrite" as const,
              pattern: "*" as const,
              action: "deny" as const,
            },
          ]),
      ...(hasTaskPermission
        ? []
        : [
            {
              permission: "task" as const,
              pattern: "*" as const,
              action: "deny" as const,
            },
          ]),
      ...(config.experimental?.primary_tools?.map((t) => ({
        pattern: "*",
        action: "allow" as const,
        permission: t,
      })) ?? []),
    ],
  })

  const msg = await MessageV2.get({ sessionID: parentSessionID, messageID: parentMessageID })
  if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

  const model = agentInfo.model ?? {
    modelID: msg.info.modelID,
    providerID: msg.info.providerID,
  }

  const messageID = MessageID.ascending()

  function cancel() {
    SessionPrompt.cancel(session.id)
  }
  ctx.abort.addEventListener("abort", cancel)
  using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

  const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)

  const result = await SessionPrompt.prompt({
    messageID,
    sessionID: session.id,
    model: {
      modelID: model.modelID,
      providerID: model.providerID,
    },
    agent: agentInfo.name,
    tools: {
      ...(hasTodoWritePermission ? {} : { todowrite: false }),
      ...(hasTaskPermission ? {} : { task: false }),
      swarm: false,
      ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
    },
    parts: promptParts,
  })

  const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

  return {
    success: true,
    description: task.description,
    output: text,
    sessionId: session.id,
  }
}

export const SwarmTool = Tool.define("swarm", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      await ctx.ask({
        permission: "swarm",
        patterns: ["*"],
        always: ["*"],
        metadata: {
          taskCount: params.tasks.length,
          descriptions: params.tasks.map((t) => t.description),
        },
      })

      const config = await Config.get()
      const maxConcurrency = config.experimental?.swarm_concurrency ?? 5

      const results: SwarmResult[] = []
      const executing = new Set<Promise<void>>()

      for (let i = 0; i < params.tasks.length; i++) {
        const task = params.tasks[i]
        const agent = await Agent.get(task.subagent_type)

        if (!agent) {
          results.push({
            success: false,
            description: task.description,
            error: `Unknown agent type: ${task.subagent_type} is not a valid agent type`,
          })
          continue
        }

        const promise = executeTask(task, ctx.sessionID, ctx.messageID, agent, ctx).then(
          (result) => {
            results[i] = result
          },
          (error) => {
            results[i] = {
              success: false,
              description: task.description,
              error: errorMessage(error),
            }
          },
        )

        executing.add(promise)
        promise.then(() => executing.delete(promise))

        if (executing.size >= maxConcurrency) {
          await Promise.race(executing)
        }
      }

      await Promise.all(executing)

      const successful = results.filter((r) => r.success).length
      const failed = results.length - successful

      const outputParts = [
        `Swarm execution complete: ${successful}/${results.length} tasks successful${failed > 0 ? `, ${failed} failed` : ""}`,
        "",
        "<swarm_results>",
        ...results.map((result, idx) => {
          const parts = [`<result index="${idx}" description="${result.description}" success="${result.success}">`]
          if (result.success) {
            parts.push(`  <session_id>${result.sessionId}</session_id>`)
            parts.push("  <output>")
            parts.push(...result.output.split("\n").map((l) => "    " + l))
            parts.push("  </output>")
          } else {
            parts.push(`  <error>${result.error}</error>`)
          }
          parts.push("</result>")
          return parts.join("\n")
        }),
        "</swarm_results>",
      ]

      return {
        title: `Swarm execution (${successful}/${results.length} successful)`,
        metadata: {
          total: results.length,
          successful,
          failed,
          tasks: params.tasks.map((t) => ({ description: t.description, subagent_type: t.subagent_type })),
        },
        output: outputParts.join("\n"),
      }
    },
  }
})
