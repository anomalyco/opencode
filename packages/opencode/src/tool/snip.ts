import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { SessionCompaction } from "../session/compaction"

export const SnipTool = Tool.define("snip", {
  description: "Snip already-eligible low-value context from the active session.",
  parameters: z.object({}),
  async execute(_input, ctx) {
    const msgs = await Session.messages({ sessionID: ctx.sessionID })
    const plan = SessionCompaction.prunePlan({ messages: msgs })
    if (!plan.parts.length)
      return {
        title: "Snip not needed",
        output: "Snipped 0 eligible context parts.",
        metadata: { snipped: 0 },
      }
    for (const part of plan.parts) {
      if (part.state.status !== "completed") continue
      part.state.time.compacted = Date.now()
      await Session.updatePart(part)
    }
    return {
      title: "Snip complete",
      output: `Snipped ${plan.parts.length} eligible context part${plan.parts.length === 1 ? "" : "s"}.`,
      metadata: { snipped: plan.parts.length },
    }
  },
})
