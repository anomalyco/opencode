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
  textAccumulator: { current: string; startTime: number | null },
): Promise<{ textAccumulator: string }> {
  if (notification.update.sessionUpdate !== "agent_message_chunk") {
    return { textAccumulator: textAccumulator.current }
  }
  if (notification.update.content.type !== "text") {
    log.warn("non-text agent_message_chunk received", {
      sessionID,
      contentType: notification.update.content.type,
    })
    return { textAccumulator: textAccumulator.current }
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
      start: textAccumulator.startTime ?? Date.now(),
    },
  }

  log.debug("attempting to save part", { partID: part.id, messageID: part.messageID, deltaLength: delta.length })
  try {
    await Session.updatePart({ part, delta })
    log.debug("successfully saved part", { partID: part.id })
  } catch (error) {
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

  return { textAccumulator: textAccumulator.current }
}

/**
 * Handle agent_thought_chunk notification (reasoning/thinking)
 */
export async function handleAgentThoughtChunk(
  sessionID: string,
  messageID: string,
  partID: string,
  notification: SessionNotification,
  thoughtAccumulator: { current: string },
): Promise<void> {
  if (notification.update.sessionUpdate !== "agent_thought_chunk") return
  if (notification.update.content.type !== "text") {
    log.warn("non-text agent_thought_chunk received", {
      sessionID,
      contentType: notification.update.content.type,
    })
    return
  }

  const delta = notification.update.content.text
  thoughtAccumulator.current += delta

  const part: MessageV2.ReasoningPart = {
    id: partID,
    sessionID,
    messageID,
    type: "reasoning",
    text: thoughtAccumulator.current,
    time: {
      start: Date.now(),
    },
  }

  // Save part to storage AND publish Bus event
  log.debug("attempting to save reasoning part", {
    partID: part.id,
    messageID: part.messageID,
    deltaLength: delta.length,
  })
  try {
    await Session.updatePart({ part, delta })
    log.debug("successfully saved reasoning part", { partID: part.id })
  } catch (error) {
    // Log the actual error details
    const err = error instanceof Error ? error : new Error(String(error))
    log.error("failed to save reasoning part", {
      error: err.message,
      stack: err.stack,
      partID: part.id,
      messageID: part.messageID,
    })
  }

  log.info("translated agent_thought_chunk", {
    sessionID,
    delta: delta.substring(0, 50),
    totalLength: thoughtAccumulator.current.length,
  })
}
