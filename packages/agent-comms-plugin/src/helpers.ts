import type { AgentConfig } from "./config"

export type AgentInfo = {
  name: string
  mode: "subagent" | "primary" | "all"
  description: string
  permission_summary: string
}

const BUILT_IN_AGENTS: Array<{
  name: string
  mode: "subagent" | "primary"
  hidden: boolean
  description: string
  permission_summary: string
}> = [
  {
    name: "build",
    mode: "primary",
    hidden: false,
    description: "Default agent. Executes tools based on configured permissions.",
    permission_summary: "full permissions",
  },
  {
    name: "plan",
    mode: "primary",
    hidden: false,
    description: "Plan mode. Disallows all edit tools.",
    permission_summary: "plan mode, no edits",
  },
  {
    name: "general",
    mode: "subagent",
    hidden: false,
    description: "General-purpose agent for researching complex questions and executing multi-step tasks.",
    permission_summary: "subagent, limited tools",
  },
  {
    name: "explore",
    mode: "subagent",
    hidden: false,
    description:
      "Fast agent specialized for exploring codebases. Use for finding files, searching code, or answering codebase questions.",
    permission_summary: "subagent, read-only",
  },
  { name: "compaction", mode: "primary", hidden: true, description: "", permission_summary: "" },
  { name: "title", mode: "primary", hidden: true, description: "", permission_summary: "" },
  { name: "summary", mode: "primary", hidden: true, description: "", permission_summary: "" },
]

export function buildAgentList(configAgents?: Record<string, AgentConfig>): AgentInfo[] {
  const result: AgentInfo[] = []
  const seen = new Set<string>()

  for (const builtIn of BUILT_IN_AGENTS) {
    const override = configAgents?.[builtIn.name]
    if (override?.disable) continue
    const hidden = override?.hidden ?? builtIn.hidden
    if (hidden) continue

    seen.add(builtIn.name)
    result.push({
      name: builtIn.name,
      mode: override?.mode ?? builtIn.mode,
      description: override?.description ?? builtIn.description,
      permission_summary: builtIn.permission_summary,
    })
  }

  if (configAgents) {
    for (const [name, cfg] of Object.entries(configAgents)) {
      if (seen.has(name)) continue
      if (cfg.disable) continue
      if (cfg.hidden) continue
      result.push({
        name,
        mode: cfg.mode ?? "all",
        description: cfg.description ?? "Custom agent",
        permission_summary: cfg.mode === "subagent" ? "subagent" : "custom",
      })
    }
  }

  return result
}

export function formatAgentList(agents: AgentInfo[]): string {
  if (agents.length === 0) return "No agents available."
  const lines = agents.map((a) => `- ${a.name} (${a.mode}) — ${a.permission_summary}. ${a.description}`)
  return `Available agent types:\n${lines.join("\n")}`
}

export function permissionSummaryForAgent(agentName: string, agents: AgentInfo[]): string {
  return agents.find((a) => a.name === agentName)?.permission_summary ?? "unknown"
}

export function formatPrompt(opts: {
  fromSessionId: string
  fromSessionTitle: string
  fromAgent: string
  toSessionId: string
  toAgent: string
  permissionSummary: string
  depth: number
  maxDepth: number
  conversationId: string
  message: string
}): string {
  return [
    `[Agent Communication — Message from session "${opts.fromSessionTitle}"]`,
    "",
    `From: ${opts.fromSessionId} (agent: ${opts.fromAgent})`,
    `To: ${opts.toSessionId} (agent: ${opts.toAgent}, ${opts.permissionSummary})`,
    `Depth: ${opts.depth}/${opts.maxDepth}`,
    `Conversation: ${opts.conversationId}`,
    "",
    "---",
    "",
    opts.message,
    "",
    "---",
    "",
    "Instructions:",
    `- This message was sent by another OpenCode agent session.`,
    `- Process this request and your response will be sent back.`,
    `- If you need to continue this conversation, use session_send with conversation_id="${opts.conversationId}".`,
    `- Do NOT exceed the maximum nesting depth of ${opts.maxDepth}.`,
    `- Your permissions: ${opts.permissionSummary}. Stay within your allowed operations.`,
  ].join("\n")
}

export function extractResponse(parts: Array<{ type: string; text?: string }>, includeThinking: boolean): string {
  const textParts = parts.filter((p) => p.type === "text" && p.text)
  const lastText = textParts[textParts.length - 1]?.text ?? ""

  if (!includeThinking) return lastText

  const thinkingParts = parts.filter((p) => p.type === "thinking" && p.text)
  const thinking = thinkingParts.map((p) => p.text).join("\n")

  if (!thinking) return lastText
  return `<thinking>\n${thinking}\n</thinking>\n\n${lastText}`
}

export function formatSystemInject(opts: {
  unread: Array<{ from_session: string; count: number; agent: string; title: string }>
  conversations: Array<{ id: string; participant_count: number }>
  crashes: Array<{ session_id: string; agent: string; error: string; max_retry: number }>
}): string {
  const parts: string[] = []

  if (opts.unread.length > 0) {
    const total = opts.unread.reduce((sum, u) => sum + u.count, 0)
    const lines = opts.unread.map((u) => `- ${u.from_session} (@${u.agent}): ${u.count} messages — "${u.title}"`)
    const convLines = opts.conversations.map((c) => `${c.id} (${c.participant_count} sessions)`)
    parts.push(
      `[Agent Communication]`,
      `You have ${total} unread message(s) from ${opts.unread.length} session(s):`,
      ...lines,
      `Use session_read to view them. Use session_send to respond.`,
      ``,
      `Active conversations: ${convLines.join(", ")}`,
    )
  }

  if (opts.crashes.length > 0) {
    const lines = opts.crashes.map(
      (c) =>
        `⚠ Session ${c.session_id} (@${c.agent}) has crashed after ${c.max_retry} retries.\n` +
        `  Last error: ${c.error}\n` +
        `  Options:\n` +
        `  1. Retry: session_send(session_id="${c.session_id}", message="retry")\n` +
        `  2. Undo & respawn: /undo ${c.session_id}, then session_send(new_session=true, agent="${c.agent}", ...)`,
    )
    parts.push(`[Agent Communication — Alerts]`, ...lines)
  }

  return parts.join("\n")
}
