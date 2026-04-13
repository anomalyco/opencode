import { tool } from "@opencode-ai/plugin"
import type { Database } from "bun:sqlite"
import { getMessages, markRead, getRegistry } from "../db"

type Deps = {
  db: Database
}

export function createSessionReadTool(deps: Deps) {
  return tool({
    description:
      "Read messages from other sessions. Only call this tool when the system prompt indicates you have unread messages. Returns unread messages and marks them as read.",
    args: {
      from_session: tool.schema.string().optional().describe("Filter by source session ID"),
      conversation_id: tool.schema.string().optional().describe("Filter by conversation ID"),
      limit: tool.schema.number().optional().describe("Max messages to return (default: 10)"),
      unread_only: tool.schema.boolean().optional().describe("Only unread messages (default: true)"),
    },
    async execute(args, ctx) {
      const filter = {
        to_session: ctx.sessionID,
        from_session: args.from_session,
        conversation_id: args.conversation_id,
        unread_only: args.unread_only !== false,
        status_exclude: ["orphaned"],
        limit: args.limit ?? 10,
      }

      const msgs = getMessages(deps.db, filter).filter((m) => m.ttl > Date.now())

      if (msgs.length === 0) return "No unread messages."

      const ids = msgs.map((m) => m.id)
      markRead(deps.db, ids)

      const lines = msgs.map((m, i) => {
        const reg = getRegistry(deps.db, m.from_session)
        const agent = reg?.last_agent ?? "unknown"
        const depth = m.depth
        const age = Date.now() - m.timestamp
        const ageStr = age < 60000 ? `${Math.floor(age / 1000)}s ago` : `${Math.floor(age / 60000)}m ago`
        const typeLabel = m.type === "response" ? "[response] " : ""
        return `[${i + 1}] From: ${m.from_session} @${agent} (depth ${depth}) — ${ageStr}\n    ${typeLabel}"${m.content}"`
      })

      return `${msgs.length} message(s):\n\n${lines.join("\n\n")}`
    },
  })
}
