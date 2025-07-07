import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import { z } from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"

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

    function summary(input: MessageV2.Info) {
      const result = []
      for (const part of input.parts) {
        if (part.type === "tool" && part.state.status === "completed") {
          result.push(part)
        }
      }
      return result
    }

    const unsub = Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
      if (evt.properties.info.sessionID !== session.id) return
      ctx.metadata({
        title: params.description,
        metadata: {
          summary: summary(evt.properties.info),
        },
      })
    })

    ctx.abort.addEventListener("abort", () => {
      Session.abort(session.id)
    })
    const result = await Session.chat({
      sessionID: session.id,
      modelID: msg.modelID,
      providerID: msg.providerID,
      parts: [
        {
          type: "text",
          text: params.prompt,
        },
      ],
    })
    unsub()
    return {
      title: params.description,
      metadata: {
        summary: summary(result),
      },
      output: result.parts.findLast((x) => x.type === "text")!.text,
    }
  },
})
