import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { SessionCompaction } from "../session/compaction"
import DESCRIPTION from "./run-compact.txt"

export const RunCompactTool = Tool.define("run_compact", {
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    if (!session) {
      throw new Error(`Session ${ctx.sessionID} not found`)
    }

    // Check if already compacting
    if (session.time.compacting) {
      return {
        title: "Compaction In Progress",
        output: "A compaction is already in progress for this session. Please wait for it to complete.",
        metadata: {},
      }
    }

    // Get the current provider and model from the session
    const messages = await Session.messages({ sessionID: ctx.sessionID })
    const lastAssistant = messages.reverse().find((m) => m.info.role === "assistant")

    if (!lastAssistant || lastAssistant.info.role !== "assistant") {
      throw new Error("Could not determine provider and model for compaction")
    }

    const providerID = lastAssistant.info.providerID
    const modelID = lastAssistant.info.modelID

    // Run compaction
    await SessionCompaction.run({
      sessionID: ctx.sessionID,
      providerID,
      modelID,
      signal: ctx.abort,
    })

    const output = `Context compaction completed successfully.

The conversation history has been summarized and compressed to reduce token usage. Old tool results have been cleared while preserving important context.

Benefits:
- Reduced token usage for future messages
- Lower costs for subsequent API calls
- More context space available for new interactions
- Preserved continuity with summary of previous conversation

You can continue the conversation normally. The summary will be included in future prompts.`

    return {
      title: "Context Compaction Complete",
      output,
      metadata: {},
    }
  },
})
