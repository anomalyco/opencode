import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2"

export function hiddenReasoning(
  msgs: AssistantMessage[],
  parts: Record<string, Part[] | undefined>,
  show: boolean,
) {
  if (show) return false

  return msgs.some((msg) => (parts[msg.id] ?? []).some((part) => part.type === "reasoning" && !!part.text?.trim()))
}
