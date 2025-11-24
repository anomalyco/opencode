import type { SessionNotification } from "@agentclientprotocol/sdk"
import { MessageV2 } from "../../session/message-v2"
import { Session } from "../../session"
import { Log } from "../../util/log"

const log = Log.create({ service: "acp-text-translator" })

/**
 * Handle agent_message_chunk notification (text streaming)
 */
export async function handleAgentMessageChunk(
  sessionID: string,
  messageID: string,
  partID: string,
  notification: SessionNotification,
  textAccumulator: { current: string },
): Promise<void> {
  if (notification.update.sessionUpdate !== "agent_message_chunk") return
  if (notification.update.content.type !== "text") {
    log.warn("non-text agent_message_chunk received", {
      sessionID,
      contentType: notification.update.content.type,
    })
    return
  }

  const delta = notification.update.content.text
  textAccumulator.current += delta

  const part: MessageV2.TextPart = {
    id: partID,
    sessionID,
    messageID,
    type: "text",
    text: textAccumulator.current,
    time: {
      start: Date.now(),
    },
  }

  // Save part to storage AND publish Bus event
  log.debug("attempting to save part", { partID: part.id, messageID: part.messageID, deltaLength: delta.length })
  try {
    await Session.updatePart({ part, delta })
    log.debug("successfully saved part", { partID: part.id })
  } catch (error) {
    // Log the actual error details
    const err = error instanceof Error ? error : new Error(String(error))
    log.error("failed to save part", {
      error: err.message,
      stack: err.stack,
      partID: part.id,
      messageID: part.messageID,
    })
  }

  log.info("translated agent_message_chunk", {
    sessionID,
    delta: delta.substring(0, 50),
    totalLength: textAccumulator.current.length,
  })
}

/**
 * Handle agent_thought_chunk notification (reasoning/thinking)
 */
export async function handleAgentThoughtChunk(
  sessionID: string,
  notification: SessionNotification,
): Promise<void> {
  if (notification.update.sessionUpdate !== "agent_thought_chunk") return
  // For MVP, we skip reasoning chunks
  if (notification.update.content.type === "text") {
    log.info("received agent_thought_chunk (skipping for MVP)", {
      sessionID,
      text: notification.update.content.text.substring(0, 50),
    })
  }
}
