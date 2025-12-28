import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"

export type SubagentOption = {
  id: string
  title: string
  agentType: string
  status: "idle" | "busy" | "retry"
  statusIcon: string
  timeAgo: string
  depth: number
  isCurrent: boolean
}

export function filterSubagents(sessions: Session[], parentID: string): Session[] {
  return sessions.filter((s) => s.parentID === parentID)
}

export function getStatusIndicator(status: SessionStatus | undefined): {
  icon: string
  status: "idle" | "busy" | "retry"
} {
  if (!status) return { icon: "●", status: "idle" }
  if (status.type === "busy") return { icon: "◐", status: "busy" }
  if (status.type === "retry") return { icon: "↻", status: "retry" }
  return { icon: "●", status: "idle" }
}

export function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return "now"
}

export function extractAgentType(session: Session): string {
  const colonIndex = session.title.indexOf(":")
  if (colonIndex > 0 && colonIndex < 20) {
    return session.title.slice(0, colonIndex).trim()
  }
  return "subagent"
}

export function findRootSession(sessions: Session[], sessionID: string): Session | undefined {
  const sessionMap = new Map(sessions.map((s) => [s.id, s]))
  let current = sessionMap.get(sessionID)

  while (current?.parentID) {
    const parent = sessionMap.get(current.parentID)
    if (!parent) break
    current = parent
  }

  return current
}

function buildTreeRecursive(
  sessions: Session[],
  statuses: Record<string, SessionStatus>,
  parentID: string,
  depth: number,
  currentSessionID: string,
): SubagentOption[] {
  const children = filterSubagents(sessions, parentID)
  const sorted = [...children].sort((a, b) => a.time.created - b.time.created)
  const result: SubagentOption[] = []

  for (const session of sorted) {
    const statusInfo = getStatusIndicator(statuses[session.id])
    result.push({
      id: session.id,
      title: session.title,
      agentType: extractAgentType(session),
      status: statusInfo.status,
      statusIcon: statusInfo.icon,
      timeAgo: formatTimeAgo(session.time.updated),
      depth,
      isCurrent: session.id === currentSessionID,
    })
    const childOptions = buildTreeRecursive(sessions, statuses, session.id, depth + 1, currentSessionID)
    result.push(...childOptions)
  }

  return result
}

export function buildSubagentOptions(
  sessions: Session[],
  statuses: Record<string, SessionStatus>,
  currentSessionID: string,
): SubagentOption[] {
  const root = findRootSession(sessions, currentSessionID)
  if (!root) return []

  return buildTreeRecursive(sessions, statuses, root.id, 0, currentSessionID)
}

export function hasSubagents(sessions: Session[], parentID: string): boolean {
  return sessions.some((s) => s.parentID === parentID)
}

export function countSubagents(sessions: Session[], parentID: string): number {
  return sessions.filter((s) => s.parentID === parentID).length
}

export function countAllDescendants(sessions: Session[], parentID: string): number {
  const direct = filterSubagents(sessions, parentID)
  let count = direct.length
  for (const child of direct) {
    count += countAllDescendants(sessions, child.id)
  }
  return count
}

export function isPartOfTree(sessions: Session[], rootID: string, sessionID: string): boolean {
  if (rootID === sessionID) return true
  const sessionMap = new Map(sessions.map((s) => [s.id, s]))
  let current = sessionMap.get(sessionID)

  while (current?.parentID) {
    if (current.parentID === rootID) return true
    current = sessionMap.get(current.parentID)
  }

  return false
}
