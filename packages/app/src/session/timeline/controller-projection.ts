import type { ModelRef, SessionInboxInfo, SessionMessageInfo } from "@opencode/client/promise"
import type { SessionMessageHandoff } from "@/session/handoff"

// Projects a submitted prompt, and the agent and model switches it makes, until the server's echoes replace them.
// The session's live selection takes each switch's echo, so a switch projects only while the session still differs.
export function applyTimelineMessageHandoff(
  messages: SessionMessageInfo[],
  handoff: SessionMessageHandoff | undefined,
  session: { agent?: string; model?: ModelRef } | undefined,
) {
  if (!handoff) return messages
  const notices = handoffNotices(handoff, session)
  const index = messages.findIndex((message) => message.id === handoff.message.id)

  if (index < 0) return [...messages, ...notices, handoff.message]
  const message = messages[index]
  const filled = message.type === "user" && !message.files?.length

  if (!filled && notices.length === 0) return messages

  return [
    ...messages.slice(0, index),
    ...notices,
    filled ? { ...message, files: handoff.message.files } : message,
    ...messages.slice(index + 1),
  ]
}

function handoffNotices(
  handoff: SessionMessageHandoff,
  session: { agent?: string; model?: ModelRef } | undefined,
): SessionMessageInfo[] {
  const time = { created: handoff.message.time.created }
  const selection = handoff.selection

  return [
    ...(session?.agent && session.agent !== selection.agent
      ? [
          {
            id: `${handoff.message.id}_agent`,
            type: "agent-switched" as const,
            agent: selection.agent,
            previous: session.agent,
            time,
          },
        ]
      : []),
    ...(session?.model &&
    (session.model.providerID !== selection.model.providerID ||
      session.model.id !== selection.model.id ||
      (session.model.variant ?? "default") !== (selection.model.variant ?? "default"))
      ? [{ id: `${handoff.message.id}_model`, type: "model-switched" as const, model: selection.model, time }]
      : []),
  ]
}

export function visibleTimelineMessages(
  messages: SessionMessageInfo[],
  pending: SessionInboxInfo[],
  revertMessageID?: string,
) {
  const queued = new Set(
    pending.flatMap((item) => (item.type === "user" && item.delivery === "queue" ? [item.id] : [])),
  )

  const inputs = new Set(
    pending.flatMap((item) =>
      (item.type === "user" && item.delivery === "steer") || item.type === "synthetic" ? [item.id] : [],
    ),
  )

  if (queued.size === 0 && inputs.size === 0 && !revertMessageID) return messages

  const visible = messages.filter(
    (message) => !queued.has(message.id) && (!revertMessageID || message.id < revertMessageID),
  )

  if (inputs.size === 0) return visible

  // Undelivered inputs do not own assistant work, so they stay below the active work like the TUI.
  // They keep admission order: the server delivers steers in that order, so delivery moves nothing.
  // A pre-promotion failure ends in a failed idle marker with no assistant work, so keep that marker
  // after the input that triggered it.
  const tail = visible.at(-1)

  if (tail?.type === "idle" && tail.outcome === "failed") {
    const start = visible.slice(0, -1).findLastIndex((message) => message.type === "idle") + 1

    if (
      visible.slice(start, -1).some((message) => inputs.has(message.id)) &&
      !visible.slice(start, -1).some((message) => message.type === "assistant")
    ) {
      const rest = visible.slice(0, -1)

      return [
        ...rest.filter((message) => !inputs.has(message.id)),
        ...rest.filter((message) => inputs.has(message.id)),
        tail,
      ]
    }
  }

  return [
    ...visible.filter((message) => !inputs.has(message.id)),
    ...visible.filter((message) => inputs.has(message.id)),
  ]
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
