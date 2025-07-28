import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import { z } from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"

export const TaskTool = Tool.define("task", async () => {
  const agents = await Agent.list()
  const description = DESCRIPTION.replace("{agents}", agents.map((a) => `- ${a.name}: ${a.description}`).join("\n"))
  return {
    description,
    parameters: z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use for this task"),
    }),
    async execute(params, ctx) {
      const session = await Session.create(ctx.sessionID)
      const msg = await Session.getMessage(ctx.sessionID, ctx.messageID)
      if (msg.role !== "assistant") throw new Error("Not an assistant message")
      const agent = await Agent.get(params.subagent_type)
      const messageID = Identifier.ascending("message")
      const parts: Record<string, MessageV2.ToolPart> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        parts[evt.properties.part.id] = evt.properties.part
        ctx.metadata({
          title: params.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id?.localeCompare(b.id)),
          },
        })
      })

      const model = agent.model ?? {
        modelID: msg.modelID,
        providerID: msg.providerID,
      }

      ctx.abort.addEventListener("abort", () => {
        Session.abort(session.id)
      })
      const result = await Session.chat({
        messageID,
        sessionID: session.id,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: msg.mode,
        system: agent.prompt,
        tools: {
          ...agent.tools,
          task: false,
        },
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: params.prompt,
          },
        ],
      })
      unsub()
      return {
        title: params.description,
        metadata: {
          summary: result.parts.filter((x) => x.type === "tool"),
        },
        output: result.parts.findLast((x) => x.type === "text")?.text ?? "",
      }
    },
  }
})
