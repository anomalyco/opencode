import { Tool } from "./tool"
import DESCRIPTION from "./tab.txt"
import z from "zod"
import { Session } from "../session"
import { MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Tab } from "../tab"
import { PermissionNext } from "@/permission"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task prompt for the new tab's session"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  label: z.string().describe("Tab label shown in the tab bar").optional(),
  directory: z.string().describe("Working directory for the tab").optional(),
})

export const TabTool = Tool.define("tab", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "tab",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      const session = await Session.create({
        title: params.description + ` (@${agent.name} subagent)`,
      })

      const tab = await Tab.add({
        sessionID: session.id,
        label: params.label ?? params.description,
        directory: params.directory,
      })

      const messageID = MessageID.ascending()
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      // Fire-and-forget — do not await
      SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        parts: promptParts,
      }).catch(() => {})

      const output = `Opened tab "${tab.label}" (session ${session.id}). The task is running independently in the background.`

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
