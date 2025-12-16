import { Log } from "../util/log"
import { ACPClient } from "./client"
import { ACPTranslator } from "./translator"
import { Instance } from "../project/instance"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { Identifier } from "../id/id"
import { AuthenticationRequiredError } from "./types"
import { Permission } from "../permission"
import type { SessionModelState, SessionModeState } from "@agentclientprotocol/sdk"
import type { ACPAgentDefinition } from "./agents"
import { DEFAULT_AGENT, getAgent, matchAgent } from "./agents"
import { Bus } from "../bus"
import { SessionMode } from "../session/mode"
import { TuiEvent } from "../cli/cmd/tui/event"

const log = Log.create({ service: "acp-orchestrator" })

/**
 * Orchestrates ACP client lifecycle for OpenCode sessions.
 *
 * Responsibilities:
 * - Lazy subprocess spawning (first prompt per session)
 * - ACP session management
 * - Notification streaming and translation
 * - Subprocess cleanup
 */
export namespace ACPOrchestrator {
  interface SessionState {
    sessionID: string
    agent: ACPAgentDefinition | null
    client: ACPClient.Instance | null
    acpSessionID: string | null
    models?: SessionModelState
    modes?: SessionModeState | null
  }

  const sessions = new Map<string, SessionState>()

  /**
   * Send a prompt to the ACP agent for a session.
   *
   * Lazily spawns subprocess on first use.
   */
  export async function sendPrompt(input: {
    sessionID: string
    parts: Array<{ type: "text"; text: string } | { type: "file"; url: string; filename: string; mime: string }>
  }): Promise<MessageV2.WithParts> {
    const state = await ensureClient(input.sessionID)

    // Create assistant message
    const assistantMessageID = Identifier.ascending("message")
    const assistantMessage: MessageV2.Assistant = {
      id: assistantMessageID,
      sessionID: input.sessionID,
      role: "assistant",
      parentID: "", // Will be set by caller
      time: {
        created: Date.now(),
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      modelID: state.models?.currentModelId ?? "default",
      providerID: "acp",
      mode: state.modes?.currentModeId ?? "build",
      path: {
        cwd: Instance.directory,
        root: Instance.directory,
      },
    }

    await Session.updateMessage(assistantMessage)

    // Start new message in translator (pass the message ID so parts are linked correctly)
    ACPTranslator.startNewMessage(input.sessionID, assistantMessageID)

    // Convert parts to simple text for MVP
    const textParts = input.parts.map((part) => {
      if (part.type === "text") {
        return part.text
      }
      return `[File: ${part.filename}]`
    })

    const promptText = textParts.join("\n")

    // Send prompt to ACP
    try {
      const promptResult = await state.client!.sendPrompt(state.acpSessionID!, promptText)

      if (promptResult.stopReason === "cancelled") {
        assistantMessage.error = new MessageV2.AbortedError({
          message: "The operation was aborted.",
        }).toObject()
      }

      log.info("prompt sent", {
        sessionID: input.sessionID,
        acpSessionID: state.acpSessionID,
        stopReason: promptResult.stopReason,
      })
    } catch (error: unknown) {
      // Handle errors from the agent (like Gemini's NOT_FOUND)
      // Extract error message from various error formats
      let errorMessage: string
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === "object" && error !== null) {
        // Handle JSON-RPC error objects
        const err = error as any
        if (err.message) {
          errorMessage = err.message
          // If there's additional detail in data.details, try to extract it
          if (err.data?.details) {
            try {
              const details = JSON.parse(err.data.details)
              if (Array.isArray(details) && details[0]?.error?.message) {
                errorMessage = details[0].error.message
              }
            } catch {
              // If parsing fails, just use the message field
            }
          }
        } else {
          errorMessage = JSON.stringify(error)
        }
      } else {
        errorMessage = String(error)
      }

      const errorDetails = typeof error === "object" && error !== null ? JSON.stringify(error) : errorMessage

      log.error("prompt failed", {
        sessionID: input.sessionID,
        acpSessionID: state.acpSessionID,
        error: errorMessage,
        details: errorDetails,
      })

      // Show error as toast instead of storing in message
      await Bus.publish(TuiEvent.ToastShow, {
        variant: "error",
        message: errorMessage,
        duration: 5000,
      })
    } finally {
      // Ensure the final text part is marked complete so print mode can exit
      await ACPTranslator.finishText(input.sessionID)
    }

    // Mark message as complete
    await Session.updateMessage({
      ...assistantMessage,
      time: {
        ...assistantMessage.time,
        completed: Date.now(),
      },
    })

    // Return the message
    return {
      info: assistantMessage,
      parts: [], // Parts were created via translator events
    }
  }

  /**
   * Ensure session state exists and client is ready for the current agent.
   * Throws an error if no agent has been set for this session.
   */
  async function ensureClient(sessionID: string): Promise<SessionState> {
    const state = sessions.get(sessionID)

    if (!state || !state.agent) {
      throw new Error(
        "No agent selected. Please select an agent before sending a prompt."
      )
    }

    if (state.client && state.acpSessionID) {
      return state
    }

    await createClientForState(state)
    return state
  }

  /**
   * Change the ACP agent for a session, recreating the client.
   */
  export async function setAgent(sessionID: string, agentName: string): Promise<SessionState> {
    const matchResult = matchAgent(agentName)
    if (!matchResult.success) {
      if (matchResult.error === "ambiguous") {
        const matches = matchResult.matches.map((a) => a.name).join(", ")
        throw new Error(`Ambiguous agent name '${agentName}'. Matches: ${matches}`)
      } else {
        throw new Error(`Agent '${agentName}' not found`)
      }
    }
    const agentDef = matchResult.match
    const existing = sessions.get(sessionID)
    const state: SessionState =
      existing ??
      {
        sessionID,
        agent: agentDef,
        client: null,
        acpSessionID: null,
        modes: undefined,
        models: undefined,
      }

    if (state.agent && state.agent.name === agentDef.name && state.client && state.acpSessionID) {
      return state
    }

    if (state.client) {
      await state.client.dispose()
    }
    ACPTranslator.resetSession(sessionID)

    state.agent = agentDef
    state.client = null
    state.acpSessionID = null
    state.modes = undefined
    state.models = undefined

    sessions.set(sessionID, state)
    await createClientForState(state)
    return state
  }

  /**
   * Set the mode for a session.
   */
  export async function setMode(sessionID: string, modeId: string): Promise<void> {
    const state = await ensureClient(sessionID)
    if (!state.modes?.availableModes?.some((m) => m.id === modeId)) {
      throw new Error(`Mode not available for agent ${state.agent!.name}: ${modeId}`)
    }

    log.info("changing mode", { sessionID, modeId })
    const previousModeId = state.modes?.currentModeId ?? null
    await state.client!.setMode(modeId as any)
    state.modes = {
      ...state.modes,
      currentModeId: modeId,
    }
    await publishModeChange(sessionID, state, previousModeId)
  }

  /**
   * Get available models for a session.
   */
  export function getModels(sessionID: string): SessionModelState | null {
    const state = sessions.get(sessionID)
    if (!state) return null
    return state.models ?? null
  }

  /**
   * Set the model for a session.
   */
  export async function setModel(sessionID: string, modelId: string): Promise<void> {
    const state = await ensureClient(sessionID)
    if (!state.models?.availableModels?.some((m) => m.modelId === modelId)) {
      throw new Error(`Model not available for agent ${state.agent!.name}: ${modelId}`)
    }

    log.info("changing model", { sessionID, modelId })

    await state.client!.setModel(modelId)

    // Update stored state
    const updatedModels = state.client!.getModels()
    if (updatedModels) {
      state.models = updatedModels
    } else {
      state.models = {
        availableModels: state.models?.availableModels ?? [],
        currentModelId: modelId,
      } as SessionModelState
    }
  }

  /**
   * Expose current state snapshot for UI/API responses.
   */
  export function getState(sessionID: string): SessionState | null {
    return sessions.get(sessionID) ?? null
  }

  async function createClientForState(state: SessionState) {
    const { sessionID, agent } = state

    if (!agent) {
      throw new Error("Cannot create client without an agent")
    }

    const client = await ACPClient.create({
      command: agent.command,
      args: agent.acpStartupArgs,
      cwd: Instance.directory,
      capabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
      },
      onSessionUpdate: async (notification) => {
        log.info("  ┌─ [ORCHESTRATOR] received notification", {
          sessionID,
          type: notification.update.sessionUpdate,
          timestamp: new Date().toISOString()
        })
        if (notification.update.sessionUpdate === "current_mode_update") {
          const previousModeId = state.modes?.currentModeId ?? null
          state.modes = {
            ...(state.modes ?? { availableModes: [] }),
            currentModeId: notification.update.currentModeId,
          }
          await publishModeChange(sessionID, state, previousModeId)
        }
        await ACPTranslator.translate(sessionID, notification)
        log.info("  └─ [ORCHESTRATOR] translate complete", {
          type: notification.update.sessionUpdate,
          timestamp: new Date().toISOString()
        })
      },
      onPermissionRequest: async (params) => {
        // CRITICAL: Use the forge sessionID, not the ACP sessionID
        // The UI looks up permissions by forge sessionID
        log.info("  ┌─ [ORCHESTRATOR] permission request", {
          forgeSessionID: sessionID,
          acpSessionID: params.sessionId,
          toolCallId: params.toolCall.toolCallId,
          title: params.toolCall.title,
        })

        try {
          await Permission.ask({
            type: "acp_tool",
            pattern: params.toolCall.kind || params.toolCall.title || "tool",
            sessionID: sessionID, // Use forge sessionID, not params.sessionId!
            messageID: "", // ACP doesn't provide messageID
            callID: params.toolCall.toolCallId,
            title: params.toolCall.title || "Tool permission required",
            metadata: {
              toolCall: params.toolCall,
              options: params.options,
            },
          })

          log.info("  └─ [ORCHESTRATOR] permission granted")

          // Permission granted
          const allowOption = params.options.find(o => o.kind === "allow_once") || params.options.find(o => o.kind === "allow_always")
          return {
            outcome: {
              outcome: "selected",
              optionId: allowOption?.optionId || "allow_once",
            },
          }
        } catch (error) {
          log.warn("  └─ [ORCHESTRATOR] permission rejected", { error })

          // Permission rejected
          const rejectOption = params.options.find(o => o.kind === "reject_once") || params.options.find(o => o.kind === "reject_always")
          return {
            outcome: {
              outcome: "selected",
              optionId: rejectOption?.optionId || "reject_once",
            },
          }
        }
      },
    })

    const initResult = await client.initialize()

    log.info("ACP initialized", {
      sessionID,
      agentName: initResult.agentInfo?.name,
      agentVersion: initResult.agentInfo?.version,
      authMethodsCount: initResult.authMethods?.length ?? 0,
    })

    let acpSession
    try {
      acpSession = await client.createSession()
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        log.info("authentication required, attempting to authenticate", {
          sessionID,
          authMethodsCount: error.authMethods.length,
        })

        if (error.authMethods.length === 0) {
          throw new Error("Agent requires authentication but provided no auth methods")
        }

        const authMethod = error.authMethods[0]
        log.info("using auth method", {
          sessionID,
          methodId: authMethod.id,
          methodName: authMethod.name,
        })

        if (authMethod._meta?.["terminal-auth"]) {
          const terminalAuth = authMethod._meta["terminal-auth"] as {
            command?: string
            args?: string[]
            label?: string
          }
          log.info("terminal authentication required", {
            sessionID,
            command: terminalAuth.command,
            args: terminalAuth.args,
          })
          throw new Error(
            `Authentication required: Please run '${terminalAuth.command} ${(terminalAuth.args ?? []).join(" ")}' in your terminal`,
          )
        }

        await client.authenticate(authMethod.id)

        acpSession = await client.createSession()
      } else {
        throw error
      }
    }

    log.info("ACP session created", {
      sessionID,
      acpSessionID: acpSession.sessionId,
    })

    const models = client.getModels()
    const modes = client.getModes()

    if (models) {
      log.info("available models", {
        sessionID,
        currentModel: models.currentModelId,
        availableModels: models.availableModels.map(m => m.modelId),
      })
    }

    state.client = client
    state.acpSessionID = acpSession.sessionId
    state.models = models ?? state.models
    state.modes = modes ?? state.modes
  }

  async function publishModeChange(sessionID: string, state: SessionState, previousModeId: string | null) {
    if (!state.modes?.currentModeId || !state.agent) return

    try {
      await Bus.publish(SessionMode.Event.Changed, {
        sessionID,
        agent: state.agent.name,
        modeId: state.modes.currentModeId,
        previousModeId,
      })
    } catch (error) {
      log.warn("failed to publish mode change", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export async function cancel(sessionID: string): Promise<void> {
    const state = sessions.get(sessionID)
    if (!state || !state.client || !state.acpSessionID) {
      log.warn("cancel skipped; session not ready", { sessionID })
      return
    }

    log.info("sending acp cancel", { sessionID, acpSessionID: state.acpSessionID })
    await state.client.cancel(state.acpSessionID)
  }

  /**
   * Cleanup a session and kill its subprocess.
   */
  export async function cleanup(sessionID: string): Promise<void> {
    const state = sessions.get(sessionID)
    if (!state) return

    log.info("cleaning up ACP session", { sessionID })

    if (state.client) {
      await state.client.dispose()
    }
    ACPTranslator.resetSession(sessionID)
    sessions.delete(sessionID)
  }

  /**
   * Cleanup all sessions.
   */
  export async function cleanupAll(): Promise<void> {
    log.info("cleaning up all ACP sessions", { count: sessions.size })
    await Promise.all(Array.from(sessions.keys()).map(cleanup))
  }
}
