import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import { z } from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"

export const TaskTool = Tool.define({
  id: "task",
  description: DESCRIPTION,
  parameters: z.object({
    description: z.string().describe("A short (3-5 words) description of the task"),
    prompt: z.string().describe("The task for the agent to perform"),
  }),
  async execute(params, ctx) {
    const session = await Session.create(ctx.sessionID)
    const msg = (await Session.getMessage(ctx.sessionID, ctx.messageID)) as MessageV2.Assistant

    const parts: Record<string, MessageV2.Part> = {}
    function summary(input: MessageV2.Part[]) {
      const result = []
      for (const part of input) {
        if (part.type === "tool" && part.state.status === "completed") {
          result.push(part)
        }
      }
      return result
    }

    const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
      if (evt.properties.part.sessionID !== session.id) return
      parts[evt.properties.part.id] = evt.properties.part
      ctx.metadata({
        title: params.description,
        metadata: {
          summary: Object.values(parts).sort((a, b) => a.id?.localeCompare(b.id)),
        },
      })
    })

    ctx.abort.addEventListener("abort", () => {
      Session.abort(session.id)
    })
    const messageID = Identifier.ascending("message")
    const result = await Session.chat({
      messageID,
      sessionID: session.id,
      modelID: msg.modelID,
      providerID: msg.providerID,
      parts: [
        {
          id: Identifier.ascending("part"),
          messageID,
          sessionID: session.id,
          type: "text",
          text: params.prompt,
        },
      ],
    })
    unsub()
    return {
      title: params.description,
      metadata: {
        summary: summary(result.parts),
      },
      output: result.parts.findLast((x) => x.type === "text")!.text,
    }
  },
})
