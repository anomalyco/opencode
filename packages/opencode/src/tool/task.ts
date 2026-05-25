import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { Truncate } from "./truncate"
import { Log } from "@/util/log"

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

export const TaskTool = Tool.define<typeof parameters, Record<string, any>>("task", async (ctx) => {
  const log = Log.create({ service: "tool.task" })
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
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
      const started = performance.now()
      log.info("tool-freeze task execute start", {
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        subagent: params.subagent_type,
        resume: !!params.task_id,
        bypassAgentCheck: !!ctx.extra?.bypassAgentCheck,
      })
      if (ctx.agent && params.subagent_type === ctx.agent) {
        log.info("tool-freeze task execute refused self", {
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          subagent: params.subagent_type,
          took: Math.round(performance.now() - started),
        })
        return {
          title: params.description,
          metadata: {
            refused: "self",
            subagent_type: params.subagent_type,
          } as Record<string, any>,
          output: `Refused to launch subagent "${params.subagent_type}" from itself. Continue in the current session instead.`,
        }
      }

      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        const permissionStart = performance.now()
        log.info("tool-freeze task permission start", {
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          subagent: params.subagent_type,
        })
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
        log.info("tool-freeze task permission end", {
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          subagent: params.subagent_type,
          took: Math.round(performance.now() - permissionStart),
        })
      }

      const agentStart = performance.now()
      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)
      log.info("tool-freeze task agent loaded", {
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        subagent: params.subagent_type,
        took: Math.round(performance.now() - agentStart),
      })

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      const sessionStart = performance.now()
      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
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
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      log.info("tool-freeze task session ready", {
        sessionID: ctx.sessionID,
        childSessionID: session.id,
        messageID: ctx.messageID,
        callID: ctx.callID,
        subagent: params.subagent_type,
        took: Math.round(performance.now() - sessionStart),
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = agent.model ?? {
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
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const resolveStart = performance.now()
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)
      log.info("tool-freeze task prompt parts ready", {
        sessionID: ctx.sessionID,
        childSessionID: session.id,
        messageID: ctx.messageID,
        callID: ctx.callID,
        subagent: params.subagent_type,
        parts: promptParts.length,
        took: Math.round(performance.now() - resolveStart),
      })

      const promptStart = performance.now()
      log.info("tool-freeze task child prompt start", {
        sessionID: ctx.sessionID,
        childSessionID: session.id,
        messageID: ctx.messageID,
        childMessageID: messageID,
        callID: ctx.callID,
        subagent: params.subagent_type,
      })
      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })
      log.info("tool-freeze task child prompt end", {
        sessionID: ctx.sessionID,
        childSessionID: session.id,
        messageID: ctx.messageID,
        childMessageID: messageID,
        callID: ctx.callID,
        subagent: params.subagent_type,
        took: Math.round(performance.now() - promptStart),
      })

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const fullOutput = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      // Apply task-specific truncation with higher limits (4000 lines / 100KB vs default 2000/50KB).
      // Setting metadata.truncated skips the automatic Truncate.output() in tool.ts,
      // preventing double-truncation.
      const out = await Truncate.output(fullOutput, { maxLines: 4000, maxBytes: 100 * 1024 })
      const output = out.truncated
        ? [
            `📁 Full task output: ${out.outputPath}`,
            `Use the Read tool with offset/limit to access the full content.`,
            "",
            `--- Preview (${fullOutput.split("\n").length} total lines, ${Buffer.byteLength(fullOutput, "utf-8")} bytes) ---`,
            out.content,
          ].join("\n")
        : out.content

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          truncated: out.truncated,
          outputPath: out.truncated ? out.outputPath : undefined,
        },
        output,
      }
    },
  }
})
