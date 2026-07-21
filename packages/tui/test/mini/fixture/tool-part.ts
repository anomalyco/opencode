import type { SessionMessageAssistantTool } from "@opencode-ai/client/promise"

export function canonicalToolPart(
  name: string,
  state: SessionMessageAssistantTool["state"],
  id = `${name}-1`,
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id,
    name,
    state,
    time:
      state.status === "streaming"
        ? { created: 1 }
        : state.status === "completed" || state.status === "error"
          ? { created: 1, ran: 1, completed: 2 }
          : { created: 1, ran: 1 },
  }
}
