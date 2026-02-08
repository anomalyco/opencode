import z from "zod"
import { Tool } from "./tool"
import { CoordInbox, CoordProtocol, CoordSummary, CoordTeam } from "@/coord"

const parameters = z.object({
  action: z.enum(["send", "broadcast", "inbox", "unread", "mark_read"]).describe("Message action"),
  team_id: z.string().describe("Team ID"),
  recipient: z.string().describe("Recipient member name").optional(),
  message: CoordProtocol.MessageInputSchema.optional(),
  from: z.string().describe("Sender name").optional(),
  content: z.string().describe("Message content").optional(),
  summary: z.string().describe("Message summary").optional(),
  index: z.number().int().optional(),
})

export const CoordMessageTool = Tool.define("coord_message", {
  description: "Send and read coordination messages.",
  parameters,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: { messages: CoordProtocol.Message[]; sent: boolean } }> {
    await ctx.ask({
      permission: "coord_message",
      patterns: [params.action],
      always: ["*"],
      metadata: {
        action: params.action,
        team_id: params.team_id,
        recipient: params.recipient,
      },
    })

    if (params.action === "inbox") {
      if (!params.recipient) throw new Error("recipient is required")
      const messages = await CoordInbox.inbox({ teamID: params.team_id, member: params.recipient })
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Inbox ${params.recipient}`,
        output: JSON.stringify(messages, null, 2),
        metadata: { messages, sent: false },
      }
    }

    if (params.action === "unread") {
      if (!params.recipient) throw new Error("recipient is required")
      const messages = await CoordInbox.unread({ teamID: params.team_id, member: params.recipient })
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Unread ${params.recipient}`,
        output: JSON.stringify(messages, null, 2),
        metadata: { messages, sent: false },
      }
    }

    if (params.action === "mark_read") {
      if (!params.recipient) throw new Error("recipient is required")
      await CoordInbox.markRead({ teamID: params.team_id, member: params.recipient, index: params.index })
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Marked read ${params.recipient}`,
        output: "true",
        metadata: { messages: [], sent: false },
      }
    }

    if (params.action === "broadcast") {
      const from = params.from ?? "coord"
      const content = params.content ?? ""
      const summary = params.summary ?? content.slice(0, 50)
      const members = await CoordTeam.memberNames(params.team_id)
      await CoordInbox.broadcast({
        teamID: params.team_id,
        from,
        recipients: members,
        content,
        summary,
      })
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Broadcast to ${members.length}`,
        output: "true",
        metadata: { messages: [], sent: true },
      }
    }

    if (params.action === "send") {
      if (!params.recipient) throw new Error("recipient is required")
      if (!params.message && !params.content) throw new Error("message or content is required")
      const from = params.from ?? "coord"
      const payload = params.message
        ? ({ ...params.message, from } as CoordProtocol.MessageInput)
        : {
            type: "message" as const,
            from,
            recipient: params.recipient,
            content: params.content ?? "",
            summary: params.summary ?? (params.content ?? "").slice(0, 50),
          }
      await CoordInbox.sendMessage({ teamID: params.team_id, recipient: params.recipient, message: payload })
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Message sent to ${params.recipient}`,
        output: "true",
        metadata: { messages: [], sent: true },
      }
    }

    throw new Error("Unsupported action")
  },
})
