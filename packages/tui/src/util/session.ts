import type { Session } from "@opencode-ai/sdk/v2"

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

export type ThreadContext = {
  type: "thread"
  selectedText?: string
  parentTitle?: string
  parentContext?: string
}

export function isThread(session: Session): boolean {
  return session.metadata?.type === "thread"
}

export function isSubagent(session: Session): boolean {
  return session.parentID !== undefined && !isThread(session)
}

export function getThreadContext(session: Session): ThreadContext | undefined {
  if (!isThread(session)) return undefined
  return {
    type: "thread",
    selectedText: session.metadata?.selectedText as string | undefined,
    parentTitle: session.metadata?.parentTitle as string | undefined,
    parentContext: session.metadata?.parentContext as string | undefined,
  }
}

export function getSelectedText(session: Session): string | undefined {
  return session.metadata?.selectedText as string | undefined
}

export function getParentTitle(session: Session): string | undefined {
  return session.metadata?.parentTitle as string | undefined
}

export function getParentContext(session: Session): string | undefined {
  return session.metadata?.parentContext as string | undefined
}

export function getAncestors(session: Session, allSessions: Session[]): Session[] {
  const result: Session[] = []
  let current = session
  while (current.parentID) {
    const parent = allSessions.find((s) => s.id === current.parentID)
    if (!parent) break
    if (isThread(parent)) {
      result.unshift(parent)
    }
    current = parent
  }
  return result
}

export function getThreadChildren(sessionID: string, allSessions: Session[]): Session[] {
  return allSessions
    .filter((s) => s.parentID === sessionID && isThread(s))
    .sort((a, b) => b.time.created - a.time.created)
}

export function getSubagentChildren(sessionID: string, allSessions: Session[]): Session[] {
  return allSessions
    .filter((s) => s.parentID === sessionID && isSubagent(s))
    .sort((a, b) => b.time.created - a.time.created)
}
