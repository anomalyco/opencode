import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { SessionID } from "../session/schema"
import { Instance } from "../project/instance"

export const SendMessageTool = Tool.define("send_message", {
  description:
    "Send a message to a target agent session by session ID. If the target session is idle, it will be woken and process the message. Use agent_list to discover active sub-agent sessions.",
  parameters: z.object({
    sessionID: z.string().describe("The target session ID to send the message to"),
    message: z.string().describe("The message content to deliver to the agent"),
    wait: z
      .boolean()
      .optional()
      .describe("Wait for the agent to finish processing and return its response (default: false)"),
  }),
  async execute(params, ctx) {
    const target = SessionID.make(params.sessionID)

    // Validate the session exists and is accessible
    const session = await Session.get(target).catch(() => {
      throw new Error(`Session not found: ${params.sessionID}`)
    })

    if (!params.wait) {
      // Fire and forget — post the message and return
      const parts = await SessionPrompt.resolvePromptParts(params.message)
      SessionPrompt.prompt({
        sessionID: target,
        parts,
        agent: session.parentID ? "build" : "primary",
      }).catch(() => {})

      return {
        title: `send_message → ${params.sessionID.slice(0, 16)}…`,
        metadata: { target: params.sessionID, waited: false },
        output: `Message sent to session ${params.sessionID}. The agent will process it asynchronously.`,
      }
    }

    // Wait for response
    const parts = await SessionPrompt.resolvePromptParts(params.message)
    const result = await SessionPrompt.prompt({
      sessionID: target,
      parts,
      agent: session.parentID ? "build" : "primary",
    })

    const text = result.parts.findLast((x) => x.type === "text")?.text ?? "(no text response)"

    return {
      title: `send_message → ${params.sessionID.slice(0, 16)}…`,
      metadata: { target: params.sessionID, waited: true },
      output: [`Response from session ${params.sessionID}:`, "", text].join("\n"),
    }
  },
})

export const AgentListTool = Tool.define("agent_list", {
  description:
    "List active sub-agent sessions spawned from the current session. Shows session IDs, titles, and status.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const children = await Session.children(ctx.sessionID).catch(
      () => [] as Awaited<ReturnType<typeof Session.children>>,
    )

    if (children.length === 0) {
      return {
        title: "agent_list",
        metadata: { count: 0 },
        output: "No active sub-agent sessions found.",
      }
    }

    const lines = children.map((s) => `- ${s.id}  "${s.title}"  (directory: ${s.directory})`).join("\n")

    return {
      title: "agent_list",
      metadata: { count: children.length },
      output: [`Active sub-agent sessions (${children.length}):`, "", lines].join("\n"),
    }
  },
})
