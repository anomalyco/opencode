import type { Message, Part } from "@opencode-ai/sdk/v2"

type WithParts = {
  info: Pick<Message, "id" | "role" | "sessionID">
  parts: Part[]
}

export function previewText(messages: WithParts[]) {
  const recent = [...messages].reverse()
  for (const message of recent) {
    const text = message.parts.find((part) => part.type === "text" && "text" in part && part.text?.trim())
    if (text && "text" in text && text.text) return text.text.trim()
  }
  return ""
}

export function buildInitialHistoryState(input: { sessionID: string; messages: WithParts[] }) {
  return {
    sessionID: input.sessionID,
    ready: false,
    previewText: previewText(input.messages),
    messages: input.messages,
  }
}

export function mergeFullHistoryState(
  current: ReturnType<typeof buildInitialHistoryState>,
  allMessages: WithParts[],
) {
  return {
    sessionID: current.sessionID,
    ready: true,
    previewText: previewText(allMessages),
    messages: allMessages,
  }
}

export function buildStagedHistoryState(input: {
  sessionID: string
  allMessages: WithParts[]
  initialCount: number
}) {
  const initialMessages = input.allMessages.slice(-Math.max(1, input.initialCount))
  const initial = buildInitialHistoryState({
    sessionID: input.sessionID,
    messages: initialMessages,
  })
  return {
    initial,
    full: mergeFullHistoryState(initial, input.allMessages),
  }
}
