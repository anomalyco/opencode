import type { SessionNotification } from "@agentclientprotocol/sdk"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import * as TextTranslator from "./translation/text"
import * as ToolTranslator from "./translation/tool"
import * as PlanTranslator from "./translation/plan"

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
    currentTextPartID: string
    textAccumulator: string
    textStartTime: number | null
    reasoningPartID: string
    reasoningAccumulator: string
    toolCallMap: Map<string, string>
  }

  const states = new Map<string, TranslatorState>()

  function getOrCreateState(sessionID: string): TranslatorState {
    let state = states.get(sessionID)
    if (!state) {
      state = {
        sessionID,
        messageID: Identifier.ascending("message"),
        currentTextPartID: "",
        textAccumulator: "",
        textStartTime: null,
        reasoningPartID: Identifier.ascending("part"),
        reasoningAccumulator: "",
        toolCallMap: new Map(),
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
    const startTime = Date.now()
    const notifType = notification.update.sessionUpdate
    log.info("  ┌─ [TRANSLATE START]", {
      type: notifType,
      sessionID,
      timestamp: new Date().toISOString(),
    })

    const state = getOrCreateState(sessionID)

    try {
      switch (notifType) {
        case "agent_message_chunk": {
          if (!state.currentTextPartID) {
            state.currentTextPartID = Identifier.ascending("part")
          }
          if (!state.textStartTime) {
            state.textStartTime = Date.now()
          }
          const result = await TextTranslator.handleAgentMessageChunk(
            sessionID,
            state.messageID,
            state.currentTextPartID,
            notification,
            {
              current: state.textAccumulator,
              startTime: state.textStartTime,
            },
          )
          state.textAccumulator = result.textAccumulator
          break
        }

        case "agent_thought_chunk": {
          await TextTranslator.handleAgentThoughtChunk(sessionID, state.messageID, state.reasoningPartID, notification, {
            current: state.reasoningAccumulator,
          })
          // Update accumulator after handler runs
          if (notification.update.content.type === "text") {
            state.reasoningAccumulator += notification.update.content.text
          }
          break
        }

        case "tool_call": {
          await ToolTranslator.handleToolCall(sessionID, state.messageID, notification, state.toolCallMap)
          state.currentTextPartID = ""
          state.textAccumulator = ""
          state.textStartTime = null
          break
        }

        case "tool_call_update": {
          await ToolTranslator.handleToolCallUpdate(sessionID, state.messageID, notification, state.toolCallMap)
          break
        }

        case "plan": {
          await PlanTranslator.handlePlan(sessionID, notification)
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

      const duration = Date.now() - startTime
      log.info("  └─ [TRANSLATE END]", {
        type: notifType,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      const duration = Date.now() - startTime
      log.error("  └─ [TRANSLATE ERROR]", {
        type: notifType,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      })
      throw error
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
    state.currentTextPartID = ""
    state.textAccumulator = ""
    state.textStartTime = null
    state.reasoningPartID = Identifier.ascending("part")
    state.reasoningAccumulator = ""
    state.toolCallMap.clear()
    log.info("started new message", { sessionID, messageID: state.messageID })
  }

  /**
   * Mark the current text part as finished and publish the final part with an end timestamp.
   */
  export async function finishText(sessionID: string): Promise<void> {
    const state = states.get(sessionID)
    if (!state || !state.currentTextPartID) return

    const part: MessageV2.TextPart = {
      id: state.currentTextPartID,
      sessionID,
      messageID: state.messageID,
      type: "text",
      text: state.textAccumulator,
      time: {
        start: state.textStartTime ?? Date.now(),
        end: Date.now(),
      },
    }

    await Session.updatePart(part)

    state.currentTextPartID = ""
    state.textAccumulator = ""
    state.textStartTime = null
  }
}
