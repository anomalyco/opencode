import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { SessionSummary } from "../session/summary"
import { Todo } from "../session/todo"
import DESCRIPTION from "./session-context.txt"

export const SessionContextTool = Tool.define("session_context", {
  description: DESCRIPTION,
  parameters: z.object({
    sessionID: z.string().describe("The session ID to fetch context from"),
    mode: z
      .enum(["summary", "messages", "diffs", "todo"])
      .describe(
        'What to retrieve: "summary" for overview, "messages" for conversation history, "diffs" for file changes, "todo" for task list',
      ),
    limit: z.coerce
      .number()
      .optional()
      .default(20)
      .describe("For messages mode, max messages to return"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "read",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const session = await Session.get(params.sessionID)
    if (!session) {
      throw new Error(
        `Session "${params.sessionID}" not found. Make sure the session ID is correct and belongs to this project.`,
      )
    }

    const output = await (async () => {
      switch (params.mode) {
        case "summary":
          return formatSummary(session, params.sessionID)
        case "messages":
          return formatMessages(params.sessionID, params.limit)
        case "diffs":
          return formatDiffs(params.sessionID, session)
        case "todo":
          return formatTodos(params.sessionID)
      }
    })()

    return {
      title: `Session context: ${session.title} (${params.mode})`,
      metadata: {
        sessionID: params.sessionID,
        mode: params.mode,
        sessionTitle: session.title,
      },
      output: `<session_context session="${session.title}" mode="${params.mode}">\n${output}\n</session_context>`,
    }
  },
})

async function formatSummary(session: Session.Info, sessionID: string) {
  const msgs = await Session.messages({ sessionID, limit: 50 })
  const lines = [] as string[]

  lines.push(`# Session: ${session.title}`)
  lines.push(`Created: ${new Date(session.time.created).toISOString()}`)
  lines.push(`Updated: ${new Date(session.time.updated).toISOString()}`)

  if (session.summary) {
    lines.push("")
    lines.push(`## File Changes`)
    lines.push(`- Files changed: ${session.summary.files}`)
    lines.push(`- Additions: +${session.summary.additions}`)
    lines.push(`- Deletions: -${session.summary.deletions}`)
  }

  // Look for compaction summary
  let found = false
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]!
    for (const part of msg.parts) {
      if (part.type === "compaction") {
        // The compaction message's text parts contain the summary
        const textParts = msg.parts.filter((p) => p.type === "text") as MessageV2.TextPart[]
        if (textParts.length > 0) {
          lines.push("")
          lines.push("## Compaction Summary")
          lines.push(textParts.map((p) => p.text).join("\n"))
          found = true
        }
        break
      }
    }
    if (found) break
  }

  if (!found) {
    // No compaction — build a condensed transcript from recent messages
    const recent = msgs.slice(-10)
    lines.push("")
    lines.push("## Recent Conversation")
    for (const msg of recent) {
      const texts = msg.parts.filter((p) => p.type === "text") as MessageV2.TextPart[]
      if (texts.length === 0) continue
      const content = texts
        .map((p) => p.text)
        .join("\n")
        .slice(0, 500)
      lines.push(`[${msg.info.role}]: ${content}`)
    }
  }

  return lines.join("\n")
}

async function formatMessages(sessionID: string, limit: number) {
  const all = await Session.messages({ sessionID, limit: Math.max(limit, 50) })
  const lines = [] as string[]

  // Use filterCompacted if there's a compaction
  const hasCompaction = all.some((m) => m.parts.some((p) => p.type === "compaction"))
  const msgs = hasCompaction
    ? await MessageV2.filterCompacted(
        (async function* () {
          for (const m of [...all].reverse()) yield m
        })(),
      )
    : all

  const limited = msgs.slice(-limit)

  for (const msg of limited) {
    const texts = msg.parts.filter((p) => p.type === "text") as MessageV2.TextPart[]
    if (texts.length === 0) continue

    const role = msg.info.role
    const agent = role === "assistant" ? (msg.info as any).agent : undefined
    const model = role === "assistant" ? (msg.info as any).modelID : undefined
    const prefix = agent || model ? `[${role}] (agent: ${agent}, model: ${model})` : `[${role}]`

    const content = texts
      .map((p) => p.text)
      .join("\n")
      .slice(0, 2000)
    lines.push(`${prefix}: ${content}`)
    lines.push("")
  }

  if (lines.length === 0) lines.push("No messages found in this session.")

  return lines.join("\n")
}

async function formatDiffs(sessionID: string, session: Session.Info) {
  const diffs = await SessionSummary.diff({ sessionID })
  const lines = [] as string[]

  if (diffs.length === 0) {
    lines.push("No file changes recorded in this session.")
    return lines.join("\n")
  }

  lines.push(`# File Changes (${diffs.length} files)`)
  if (session.summary) {
    lines.push(`Total: +${session.summary.additions} -${session.summary.deletions}`)
  }
  lines.push("")

  for (const diff of diffs) {
    lines.push(`## ${diff.file} (${diff.status ?? "modified"}) +${diff.additions} -${diff.deletions}`)
    lines.push("")
  }

  return lines.join("\n")
}

async function formatTodos(sessionID: string) {
  const todos = await Todo.get(sessionID)
  const lines = [] as string[]

  if (todos.length === 0) {
    lines.push("No todos found in this session.")
    return lines.join("\n")
  }

  lines.push(`# Todo List (${todos.length} items)`)
  lines.push("")

  for (const todo of todos) {
    const icon =
      todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[~]" : todo.status === "cancelled" ? "[-]" : "[ ]"
    const priority = todo.priority === "high" ? " (HIGH)" : todo.priority === "low" ? " (low)" : ""
    lines.push(`- ${icon} ${todo.content}${priority}`)
  }

  return lines.join("\n")
}
