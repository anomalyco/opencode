import { Session } from "../session"
import type { MessageV2 } from "../session/message-v2"

export async function summarizeSession(
  sessionId: string,
  sessionTitle: string | null,
  projectDir: string,
): Promise<string> {
  // Get last 50 messages
  const msgs = await Session.messages({ sessionID: sessionId as any, limit: 50 })

  const lines: string[] = []
  lines.push(`# Session: ${sessionTitle || sessionId}`)
  lines.push(`Directory: ${projectDir}`)
  lines.push(`Date: ${new Date().toISOString().split("T")[0]}`)
  lines.push("")

  // Extract user requests (last 10)
  const userMessages = msgs
    .filter((m) => m.info.role === "user")
    .map((m) => {
      const text = (m.parts as any[])
        ?.filter((p) => p.type === "text")
        .map((p) => (p as MessageV2.TextPart).text)
        .join(" ")
        .trim()
      return text
    })
    .filter(Boolean)
    .slice(-10)

  if (userMessages.length > 0) {
    lines.push("## What was worked on")
    for (const msg of userMessages) {
      const truncated = msg.length > 200 ? msg.slice(0, 200) + "\u2026" : msg
      lines.push(`- ${truncated}`)
    }
    lines.push("")
  }

  // Extract tool usage (files written, commands run)
  const toolActions: string[] = []
  for (const msg of msgs) {
    for (const part of (msg.parts as any[]) ?? []) {
      if (part.type === "tool") {
        const toolPart = part as MessageV2.ToolPart
        const state = toolPart.state
        if (state.status === "completed" || state.status === "running" || state.status === "error") {
          const input = (state as any).input ?? {}
          if (toolPart.tool === "write" && input.path) {
            toolActions.push(`Edited: ${input.path}`)
          } else if (toolPart.tool === "bash" && input.command) {
            const cmd = String(input.command).slice(0, 80)
            toolActions.push(`Ran: ${cmd}`)
          }
        }
      }
    }
  }

  const uniqueActions = [...new Set(toolActions)].slice(0, 15)
  if (uniqueActions.length > 0) {
    lines.push("## Key actions")
    for (const action of uniqueActions) {
      lines.push(`- ${action}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
