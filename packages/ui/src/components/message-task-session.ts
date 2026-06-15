import type { Session, ToolPart } from "@opencode-ai/sdk/v2"

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const next = value.trim()
  if (!next) return undefined
  return next
}

function taskStartTime(part: ToolPart | undefined): number | undefined {
  const state = part?.state
  if (!state || state.status === "pending") return undefined
  return state.time.start
}

function taskTitleMatches(session: Session, description: string | undefined): boolean {
  if (!description) return false
  const title = text(session.title)
  if (!title) return false
  return title === description || title.startsWith(`${description} (@`)
}

export function resolveTaskChildSessionId(input: {
  metadata?: Record<string, unknown>
  tool?: ToolPart
  input?: Record<string, unknown>
  sessions?: readonly Session[]
}): string | undefined {
  const direct = text(input.metadata?.sessionId) ?? text(input.metadata?.sessionID)
  if (direct) return direct

  const parentID = input.tool?.sessionID
  if (!parentID) return undefined

  const toolInput = input.input ?? input.tool?.state.input ?? {}
  const description = text(toolInput.description)
  const agent = text(toolInput.subagent_type) ?? text(toolInput.agent)
  const children = (input.sessions ?? []).filter((session) => {
    if (session.parentID !== parentID) return false
    return !session.time.archived
  })
  if (children.length === 0) return undefined

  const titleMatches = children.filter((session) => taskTitleMatches(session, description))
  const agentMatches = agent ? children.filter((session) => text(session.agent) === agent) : []
  const candidates = titleMatches.length > 0 ? titleMatches : children.length === 1 ? children : agentMatches
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]?.id

  const start = taskStartTime(input.tool)
  if (start === undefined) return undefined
  return candidates.toSorted((a, b) => Math.abs(a.time.created - start) - Math.abs(b.time.created - start))[0]?.id
}
