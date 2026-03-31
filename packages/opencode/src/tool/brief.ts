import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { SessionCompaction } from "../session/compaction"
import { SessionPrompt } from "../session/prompt"
import type { SessionID } from "../session/schema"

async function state(sessionID: SessionID) {
  const msgs = await Session.messages({ sessionID })
  const user = msgs.findLast((item) => item.info.role === "user")
  if (user && user.info.role === "user") return { agent: user.info.agent, model: user.info.model }
  const [agent, model] = await Promise.all([Agent.defaultAgent(), Provider.defaultModel()])
  return { agent, model }
}

export const BriefTool = Tool.define("brief", {
  description: "Create a compact briefing of the current session using the active session context and model settings.",
  parameters: z.object({}),
  async execute(_input, ctx) {
    const next = await state(ctx.sessionID)
    await SessionCompaction.create({
      sessionID: ctx.sessionID,
      agent: next.agent,
      model: next.model,
      auto: false,
    })
    await SessionPrompt.loop({ sessionID: ctx.sessionID })
    return {
      title: "Brief complete",
      output: "Created a concise session brief.",
      metadata: {},
    }
  },
})
