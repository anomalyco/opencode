import type { SessionInboxInfo, SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"

export function applyTimelineMessageHandoff(messages: SessionMessageInfo[], handoff?: SessionMessageUser) {
  if (!handoff) return messages
  const index = messages.findIndex((message) => message.id === handoff.id)
  if (index < 0) return [...messages, handoff]
  const message = messages[index]
  if (message.type !== "user" || message.files?.length) return messages
  return messages.map((item, current) => (current === index ? { ...message, files: handoff.files } : item))
}

export function visibleTimelineMessages(
  messages: SessionMessageInfo[],
  pending: SessionInboxInfo[],
  revertMessageID?: string,
) {
  const queued = new Set(
    pending.flatMap((item) => (item.type === "user" && item.delivery === "queue" ? [item.id] : [])),
  )
  if (queued.size === 0 && !revertMessageID) return messages
  return messages.filter((message) => !queued.has(message.id) && (!revertMessageID || message.id < revertMessageID))
}

export function timelineChildTitle(input: {
  parentID?: string
  taskDescription?: string
  title?: string
  fallback: string
}) {
  if (!input.parentID) return input.title ?? ""
  if (input.taskDescription) return input.taskDescription
  return input.title?.replace(/\s+\(@[^)]+ subagent\)$/, "") || input.fallback
}

export function timelineRemovedSessionIDs(sessions: readonly { id: string; parentID?: string }[], sessionID: string) {
  const removed = new Set([sessionID])
  const byParent = Map.groupBy(
    sessions.filter((session) => session.parentID),
    (session) => session.parentID!,
  )
  const visit = (id: string) =>
    byParent.get(id)?.forEach((child) => {
      if (removed.has(child.id)) return
      removed.add(child.id)
      visit(child.id)
    })
  visit(sessionID)
  return removed
}
