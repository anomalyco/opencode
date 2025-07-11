import type { MessageV2 } from "opencode/session/message-v2"
import type { Message } from "opencode/session/message"
import type { Session } from "opencode/session/index"
import { fromV1 } from "../components/Share"

export interface SessionData {
  rootDir: string | undefined
  created: number
  completed: number | undefined
  models: Record<string, string[]>
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
  }
}

export function computeSessionData(
  sessionInfo: Session.Info,
  messages: (MessageV2.Info | Message.Info)[],
): SessionData {
  const result: SessionData = {
    rootDir: undefined,
    created: sessionInfo.time.created,
    completed: undefined,
    models: {},
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
    },
  }

  for (let i = 0; i < messages.length; i++) {
    // Normalize to V2 format using same pattern as Share.tsx
    const msg = "metadata" in messages[i] ? fromV1(messages[i] as Message.Info) : (messages[i] as MessageV2.Info)

    if (msg.role === "assistant") {
      const assistantMsg = msg as MessageV2.Assistant
      result.cost += assistantMsg.cost || 0
      result.tokens.input += assistantMsg.tokens?.input || 0
      result.tokens.output += assistantMsg.tokens?.output || 0
      result.tokens.reasoning += assistantMsg.tokens?.reasoning || 0

      if (assistantMsg.providerID && assistantMsg.modelID) {
        result.models[`${assistantMsg.providerID} ${assistantMsg.modelID}`] = [
          assistantMsg.providerID,
          assistantMsg.modelID,
        ]
      }

      if (assistantMsg.path?.root) {
        result.rootDir = assistantMsg.path.root
      }

      if (assistantMsg.time?.completed) {
        result.completed = assistantMsg.time.completed
      }
    }
  }

  return result
}

export async function fetchProjectSessions(localApiUrl: string) {
  const response = await fetch(`${localApiUrl}/session`, {
    method: "GET",
  })

  if (!response.ok) {
    throw new Error("Failed to fetch sessions")
  }

  return await response.json()
}

export async function fetchSessionMessages(localApiUrl: string, sessionId: string) {
  const response = await fetch(`${localApiUrl}/session/${sessionId}/message`, {
    method: "get",
    headers: { "Content-Type": "application/json" },
  })

  if (!response.ok) {
    throw new Error("Failed to fetch session messages")
  }

  return await response.json()
}

export async function fetchExportedSessions(localApiUrl: string) {
  const response = await fetch(`${localApiUrl}/session/export`, {
    method: "GET",
  })

  if (!response.ok) {
    return []
  }

  return await response.json()
}
