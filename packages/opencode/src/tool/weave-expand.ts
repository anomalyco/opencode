import z from "zod"
import { Tool } from "./tool"
import { WeaveDB } from "@/session/weave"

export const WeaveExpandTool = Tool.define("weave_expand", {
  description:
    "Expand a Weave message reference back to current message content. Use ids like weave:<opencode-message-id>.",
  parameters: z.object({
    weave_message_id: z.string().describe("Weave message id to expand (e.g. weave:01H...)."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "weave_expand",
      patterns: ["*"],
      always: ["*"],
      metadata: { weave_message_id: params.weave_message_id },
    })
    const opencodeID = params.weave_message_id.startsWith("weave:")
      ? params.weave_message_id.slice("weave:".length)
      : params.weave_message_id

    const linked = await WeaveDB.resolveWeaveMessageID(ctx.sessionID, opencodeID)
    const match = ctx.messages.find((message) => message.info.id === opencodeID)
    if (!match) {
      return {
        title: "Weave expand",
        metadata: { found: false, linked_weave_id: "" },
        output: `No message found for ${params.weave_message_id}.`,
      }
    }

    const parts = match.parts
      .map((part) => {
        if (part.type === "text") return part.text
        if (part.type === "tool") return `[tool:${part.tool}]`
        if (part.type === "file") return `[file:${part.filename ?? "unnamed"}]`
        return `[${part.type}]`
      })
      .join("\n")

    return {
      title: "Weave expand",
      metadata: { found: true, linked_weave_id: linked ?? params.weave_message_id },
      output: [`message_id: ${match.info.id}`, `role: ${match.info.role}`, "", parts].join("\n"),
    }
  },
})
