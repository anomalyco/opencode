import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Todo } from "../session/todo"

import SESSION_LIST_DESCRIPTION from "./session-list.txt"
import SESSION_READ_DESCRIPTION from "./session-read.txt"
import SESSION_SEARCH_DESCRIPTION from "./session-search.txt"
import SESSION_INFO_DESCRIPTION from "./session-info.txt"

function formatDate(timestamp: number) {
  return new Date(timestamp).toISOString().split("T")[0]
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19)
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  const parts = []
  if (days > 0) parts.push(`${days} day${days > 1 ? "s" : ""}`)
  if (hours % 24 > 0) parts.push(`${hours % 24} hour${hours % 24 > 1 ? "s" : ""}`)
  if (parts.length === 0 && minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`)
  if (parts.length === 0) parts.push(`${seconds} second${seconds > 1 ? "s" : ""}`)

  return parts.join(", ")
}

export const SessionListTool = Tool.define("session_list", {
  description: SESSION_LIST_DESCRIPTION,
  parameters: z.object({
    query: z.string().optional().describe("Filter sessions by title (case-insensitive)"),
    limit: z.coerce.number().optional().describe("Maximum sessions to return (default: 5)"),
    from_date: z.string().optional().describe("Filter sessions from this date (ISO 8601)"),
    to_date: z.string().optional().describe("Filter sessions until this date (ISO 8601)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "session",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const maxResults = params.limit ?? 5
    const fromTimestamp = params.from_date ? new Date(params.from_date).getTime() : undefined
    const toTimestamp = params.to_date ? new Date(params.to_date).getTime() : undefined
    const queryLower = params.query?.toLowerCase()

    const sessions: Array<{ info: Session.Info; messageCount: number; lastMessage?: number }> = []

    for await (const session of Session.list()) {
      if (session.id === ctx.sessionID) continue
      if (queryLower && !session.title.toLowerCase().includes(queryLower)) continue
      if (fromTimestamp && session.time.created < fromTimestamp) continue
      if (toTimestamp && session.time.created > toTimestamp) continue

      const msgs = await Session.messages({ sessionID: session.id })
      const last = msgs.length > 0 ? Math.max(...msgs.map((m) => m.info.time.created)) : undefined

      sessions.push({ info: session, messageCount: msgs.length, lastMessage: last })
      if (sessions.length >= maxResults) break
    }

    if (sessions.length === 0) {
      return {
        title: "Sessions",
        metadata: { count: 0 },
        output: params.query ? `No sessions matching "${params.query}"` : "No sessions found.",
      }
    }

    const lines = sessions.map((s) => {
      const date = s.lastMessage ? formatDateTime(s.lastMessage) : "-"
      const title = s.info.title.length > 50 ? s.info.title.slice(0, 47) + "..." : s.info.title
      return `${s.info.id} | ${s.messageCount} msgs | ${date} | ${title}`
    })

    return {
      title: `${sessions.length} sessions`,
      metadata: { count: sessions.length },
      output: lines.join("\n"),
    }
  },
})

export const SessionReadTool = Tool.define("session_read", {
  description: SESSION_READ_DESCRIPTION,
  parameters: z.object({
    session_id: z.string().describe("Session ID to read"),
    query: z.string().optional().describe("Filter messages containing this text (case-insensitive)"),
    include_todos: z.boolean().optional().describe("Include todo list if available (default: false)"),
    include_transcript: z.boolean().optional().describe("Include transcript log if available (default: false)"),
    limit: z.coerce.number().optional().describe("Maximum messages to return (default: 30)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "session",
      patterns: [params.session_id],
      always: ["*"],
      metadata: { session_id: params.session_id },
    })

    const session = await Session.get(params.session_id)
    const allMsgs = await Session.messages({ sessionID: params.session_id })
    const maxMsgs = params.limit ?? 30

    const filtered = params.query
      ? allMsgs.filter((msg) =>
          msg.parts.some(
            (part) => part.type === "text" && part.text.toLowerCase().includes(params.query!.toLowerCase()),
          ),
        )
      : allMsgs
    const msgs = filtered.slice(0, maxMsgs)
    const hasMore = filtered.length > maxMsgs

    const lines: string[] = []
    lines.push(`Session: ${session.id} | Title: ${session.title}`)
    lines.push(
      `Total: ${allMsgs.length} msgs${params.query ? ` | Matching "${params.query}": ${filtered.length}` : ""}${hasMore ? ` | Showing first ${maxMsgs}` : ""}`,
    )
    lines.push("")

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]
      const timestamp = formatDateTime(msg.info.time.created)
      const role = msg.info.role

      lines.push(`[${i + 1}] ${role} (${timestamp})`)
      for (const part of msg.parts) {
        if (part.type === "text") {
          const text = part.text.length > 500 ? part.text.slice(0, 497) + "..." : part.text
          lines.push(text)
        }
        if (part.type === "tool" && part.state.status === "completed") {
          lines.push(`  → ${part.tool}: ${part.state.title}`)
        }
      }
      lines.push("")
    }

    if (params.include_todos) {
      const todos = await Todo.get(params.session_id)
      if (todos.length > 0) {
        lines.push("--- Todos ---")
        for (const todo of todos) {
          const status = todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[>]" : "[ ]"
          lines.push(`${status} ${todo.content} (${todo.priority})`)
        }
        lines.push("")
      }
    }

    return {
      title: session.title || session.id,
      metadata: { total: allMsgs.length, returned: msgs.length, filtered: !!params.query },
      output: lines.join("\n"),
    }
  },
})

export const SessionSearchTool = Tool.define("session_search", {
  description: SESSION_SEARCH_DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Search query string"),
    session_id: z.string().optional().describe("Search within specific session only (default: all sessions)"),
    case_sensitive: z.boolean().optional().describe("Case-sensitive search (default: false)"),
    limit: z.coerce.number().optional().describe("Maximum results to return (default: 10)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "session",
      patterns: [params.query],
      always: ["*"],
      metadata: { query: params.query },
    })

    const maxResults = params.limit ?? 10
    const query = params.case_sensitive ? params.query : params.query.toLowerCase()

    const matches: Array<{
      sessionID: string
      messageID: string
      role: string
      excerpt: string
    }> = []

    const searchSession = async (sessionID: string) => {
      const msgs = await Session.messages({ sessionID })
      for (const msg of msgs) {
        if (matches.length >= maxResults) return

        for (const part of msg.parts) {
          if (part.type !== "text") continue

          const text = params.case_sensitive ? part.text : part.text.toLowerCase()
          const idx = text.indexOf(query)
          if (idx === -1) continue

          const start = Math.max(0, idx - 50)
          const end = Math.min(part.text.length, idx + query.length + 50)
          let excerpt = part.text.slice(start, end)
          if (start > 0) excerpt = "..." + excerpt
          if (end < part.text.length) excerpt = excerpt + "..."

          const highlighted = excerpt.replace(
            new RegExp(params.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), params.case_sensitive ? "g" : "gi"),
            `**$&**`,
          )

          matches.push({
            sessionID,
            messageID: msg.info.id,
            role: msg.info.role,
            excerpt: highlighted,
          })

          if (matches.length >= maxResults) return
        }
      }
    }

    if (params.session_id) {
      await searchSession(params.session_id)
    } else {
      for await (const session of Session.list()) {
        if (session.id === ctx.sessionID) continue
        if (matches.length >= maxResults) break
        await searchSession(session.id)
      }
    }

    if (matches.length === 0) {
      return {
        title: `Search: ${params.query}`,
        metadata: { matches: 0, sessions: 0 },
        output: `No matches found for "${params.query}"`,
      }
    }

    const sessionCount = new Set(matches.map((m) => m.sessionID)).size
    const lines = [`Found ${matches.length} matches in ${sessionCount} sessions:`, ""]

    for (const match of matches) {
      lines.push(`[${match.sessionID}] (${match.role}): ${match.excerpt}`)
    }

    return {
      title: `Search: ${params.query}`,
      metadata: { matches: matches.length, sessions: sessionCount },
      output: lines.join("\n"),
    }
  },
})

export const SessionInfoTool = Tool.define("session_info", {
  description: SESSION_INFO_DESCRIPTION,
  parameters: z.object({
    session_id: z.string().describe("Session ID to inspect"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "session",
      patterns: [params.session_id],
      always: ["*"],
      metadata: { session_id: params.session_id },
    })

    const session = await Session.get(params.session_id)
    const msgs = await Session.messages({ sessionID: params.session_id })
    const todos = await Todo.get(params.session_id)

    const agents = new Set<string>()
    let first: number | undefined
    let last: number | undefined

    for (const msg of msgs) {
      if (msg.info.role === "user" || msg.info.role === "assistant") {
        agents.add(msg.info.agent)
        const t = msg.info.time.created
        if (!first || t < first) first = t
        if (!last || t > last) last = t
      }
    }

    const lines: string[] = []
    lines.push(`Session ID: ${session.id}`)
    lines.push(`Title: ${session.title}`)
    lines.push(`Messages: ${msgs.length}`)

    if (first && last) {
      lines.push(`Date Range: ${formatDateTime(first)} to ${formatDateTime(last)}`)
      lines.push(`Duration: ${formatDuration(last - first)}`)
    }

    lines.push(`Agents Used: ${Array.from(agents).join(", ") || "none"}`)

    if (todos.length > 0) {
      const completed = todos.filter((t) => t.status === "completed").length
      lines.push(`Has Todos: Yes (${todos.length} items, ${completed} completed)`)
    } else {
      lines.push(`Has Todos: No`)
    }

    if (session.share?.url) {
      lines.push(`Shared: ${session.share.url}`)
    }

    return {
      title: session.title || session.id,
      metadata: {
        messages: msgs.length,
        agents: Array.from(agents),
        todos: todos.length,
      },
      output: lines.join("\n"),
    }
  },
})
