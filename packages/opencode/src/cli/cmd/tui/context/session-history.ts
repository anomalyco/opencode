type WithParts = {
  info: { id: string; role: string; sessionID: string }
  parts: Array<{
    id: string
    type: string
    text?: string
    sessionID: string
    messageID: string
  }>
}

export function previewText(messages: WithParts[]) {
  const recent = [...messages].reverse()
  for (const message of recent) {
    const text = message.parts.find((part) => part.type === "text" && part.text?.trim())
    if (text?.text) return text.text.trim()
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
