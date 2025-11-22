import type { SessionNotification } from "@agentclientprotocol/sdk"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { TuiEvent } from "../cli/cmd/tui/event"
import { Identifier } from "../id/id"
import { Log } from "../util/log"

const log = Log.create({ service: "acp-translator" })

/**
 * Translator that converts ACP session notifications into OpenCode Bus events.
 *
 * This enables the OpenCode TUI to display ACP agent responses without modification.
 */
export namespace ACPTranslator {
  interface TranslatorState {
    sessionID: string
    messageID: string
    partID: string
    textAccumulator: string
  }

  const states = new Map<string, TranslatorState>()

  function getOrCreateState(sessionID: string): TranslatorState {
    let state = states.get(sessionID)
    if (!state) {
      state = {
        sessionID,
        messageID: Identifier.ascending("message"),
        partID: Identifier.ascending("part"),
        textAccumulator: "",
      }
      states.set(sessionID, state)
    }
    return state
  }

  /**
   * Translate an ACP SessionNotification into OpenCode Bus events.
   *
   * For MVP, we only handle text chunks. Unknown content types are shown as debug toasts.
   */
  export async function translate(sessionID: string, notification: SessionNotification): Promise<void> {
    const state = getOrCreateState(sessionID)

    switch (notification.update.sessionUpdate) {
      case "agent_message_chunk": {
        if (notification.update.content.type !== "text") {
          await showDebugToast("Unknown agent_message_chunk content type", notification)
          return
        }

        const delta = notification.update.content.text
        state.textAccumulator += delta

        const part: MessageV2.TextPart = {
          id: state.partID,
          sessionID: state.sessionID,
          messageID: state.messageID,
          type: "text",
          text: state.textAccumulator,
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
          totalLength: state.textAccumulator.length,
        })
        break
      }

      case "agent_thought_chunk": {
        // For MVP, we could either skip reasoning or show it
        // For now, let's show it as a debug toast
        if (notification.update.content.type === "text") {
          log.info("received agent_thought_chunk (skipping for MVP)", {
            sessionID,
            text: notification.update.content.text.substring(0, 50),
          })
        }
        break
      }

      case "tool_call":
      case "tool_call_update": {
        // For MVP, we're not handling tools yet
        await showDebugToast(`Tool call: ${notification.update.toolCallId}`, notification)
        break
      }

      case "plan": {
        // For MVP, we're not handling plans yet
        await showDebugToast("Plan update received", notification)
        break
      }

      case "user_message_chunk": {
        // Usually we don't need to handle user messages from ACP, but log it
        log.info("received user_message_chunk", { sessionID })
        break
      }

      case "available_commands_update": {
        log.info("received available_commands_update", {
          sessionID,
          commands: notification.update.availableCommands.length,
        })
        break
      }

      case "current_mode_update": {
        log.info("received current_mode_update", {
          sessionID,
          modeId: notification.update.currentModeId,
        })
        break
      }

      default: {
        await showDebugToast("Unknown ACP notification type", notification)
        break
      }
    }
  }

  /**
   * Show a debug toast with the raw JSON of unknown content.
   */
  async function showDebugToast(title: string, notification: SessionNotification): Promise<void> {
    log.warn("showing debug toast", { title, notification })

    try {
      await Bus.publish(TuiEvent.ToastShow, {
        title,
        message: `DEBUG: ${JSON.stringify(notification, null, 2).substring(0, 200)}...`,
        variant: "info",
        duration: 10000,
      })
    } catch (error) {
      // In test environments without Instance context, just log
      log.warn("failed to show toast (likely no Instance context)", { error })
    }
  }

  /**
   * Reset translator state for a session (e.g., when starting a new message).
   */
  export function resetSession(sessionID: string): void {
    states.delete(sessionID)
    log.info("reset session state", { sessionID })
  }

  /**
   * Create a new message in the session (should be called before agent starts responding).
   */
  export function startNewMessage(sessionID: string, messageID: string): void {
    const state = getOrCreateState(sessionID)
    state.messageID = messageID
    state.partID = Identifier.ascending("part")
    state.textAccumulator = ""
    log.info("started new message", { sessionID, messageID: state.messageID })
  }
}
