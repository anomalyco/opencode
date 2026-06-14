import type { Message, Part, Session, SessionStatus, ToolPart } from "@opencode-ai/sdk/v2/client"
import { working } from "./session-working"

type SessionChildAgentStatus = Exclude<ToolPart["state"]["status"], "pending">

export type SessionChildAgentEntry = {
  id: string
  sessionID: string
  title: string
  agent?: string
  description?: string
  created: number
  status?: SessionChildAgentStatus
}

type CollectChildAgentEntriesInput = {
  sessionID?: string
  messages: readonly Message[]
  parts: Record<string, readonly Part[] | undefined>
  sessions: readonly Session[]
  messagesBySession?: Record<string, readonly Message[] | undefined>
  statuses?: Record<string, SessionStatus | undefined>
}

const taskTool = (part: Part): part is ToolPart => part.type === "tool" && part.tool.trim().toLowerCase() === "task"

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return
  const next = value.trim()
  return next || undefined
}

const stateMetadata = (state: ToolPart["state"]): Record<string, unknown> | undefined => {
  if (state.status === "pending") return
  return state.metadata
}

const stateStart = (state: ToolPart["state"]): number | undefined => {
  if (state.status === "pending") return
  return state.time.start
}

const stateTitle = (state: ToolPart["state"]): string | undefined => {
  if (!("title" in state)) return
  return text(state.title)
}

const sessionTitle = (
  session: Session | undefined,
  description: string | undefined,
  agent: string | undefined,
): string => {
  const title = text(session?.title)
  if (title) return title
  if (description && agent) return `${description} (@${agent} subagent)`
  if (description) return description
  if (agent) return `@${agent} subagent`
  return "Subagent"
}

export function collectSessionChildAgentEntries(input: CollectChildAgentEntriesInput): SessionChildAgentEntry[] {
  const childSessions = input.sessions.filter(
    (session) => input.sessionID !== undefined && session.parentID === input.sessionID,
  )
  const sessionByID = new Map(childSessions.map((session) => [session.id, session] as const))
  const entries: Array<SessionChildAgentEntry & { order: number }> = []
  let order = 0
  const statusFor = (sessionID: string, toolStatus?: SessionChildAgentStatus): SessionChildAgentStatus | undefined => {
    const messages = input.messagesBySession?.[sessionID]
    if (working(input.statuses?.[sessionID], messages)) return "running"
    if (messages !== undefined) {
      const last = messages.at(-1)
      if (last?.role === "assistant" && typeof last.time.completed === "number") return "completed"
    }
    if (toolStatus === "running" || toolStatus === "error") return toolStatus
  }

  for (const message of input.messages) {
    const parts = input.parts[message.id] ?? []
    for (const part of parts) {
      if (!taskTool(part)) continue

      const metadata = stateMetadata(part.state)
      const sessionID = text(metadata?.sessionId) ?? text(metadata?.sessionID)
      if (!sessionID) continue

      const description = text(part.state.input.description) ?? stateTitle(part.state)
      const agent = text(part.state.input.subagent_type) ?? text(part.state.input.agent)
      const session = sessionByID.get(sessionID)

      entries.push({
        id: `tool:${part.messageID}:${part.id}:${sessionID}`,
        sessionID,
        title: sessionTitle(session, description, agent),
        agent: agent ?? text(session?.agent),
        description,
        created: stateStart(part.state) ?? session?.time.created ?? message.time.created,
        status: statusFor(sessionID, part.state.status === "pending" ? undefined : part.state.status),
        order,
      })
      order += 1
    }
  }

  const sessionIDs = new Set(entries.map((entry) => entry.sessionID))
  for (const session of childSessions) {
    if (sessionIDs.has(session.id)) continue
    entries.push({
      id: `session:${session.id}`,
      sessionID: session.id,
      title: sessionTitle(session, undefined, text(session.agent)),
      agent: text(session.agent),
      created: session.time.created,
      status: statusFor(session.id),
      order,
    })
    order += 1
  }

  return entries
    .toSorted((a, b) => a.created - b.created || a.order - b.order)
    .map(({ order: _order, ...entry }) => entry)
}
