import { Log } from "../util/log"
import { ACPClient } from "./client"
import { ACPTranslator } from "./translator"
import { Instance } from "../project/instance"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { Identifier } from "../id/id"
import { AuthenticationRequiredError } from "./types"
import { Permission } from "../permission"
import type { SessionModelState, ModelId, SessionModeState } from "@agentclientprotocol/sdk"
import { ACPAgentDefinition, DEFAULT_AGENT, getAgent } from "./agents"

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
    agent: ACPAgentDefinition
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
    const promptResult = await state.client!.sendPrompt(state.acpSessionID!, promptText)

    log.info("prompt sent", {
      sessionID: input.sessionID,
      acpSessionID: state.acpSessionID,
      stopReason: promptResult.stopReason,
    })

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
   */
  async function ensureClient(sessionID: string): Promise<SessionState> {
    let state = sessions.get(sessionID)

    if (!state) {
      state = {
        sessionID,
        agent: DEFAULT_AGENT,
        client: null,
        acpSessionID: null,
        modes: undefined,
        models: undefined,
      }
      sessions.set(sessionID, state)
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
    const agentDef = getAgent(agentName) ?? DEFAULT_AGENT
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

    if (state.agent.name === agentDef.name && state.client && state.acpSessionID) {
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
      throw new Error(`Mode not available for agent ${state.agent.name}: ${modeId}`)
    }

    log.info("changing mode", { sessionID, modeId })
    await state.client!.setMode(modeId as any)
    state.modes = {
      ...state.modes,
      currentModeId: modeId,
    }
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
  export async function setModel(sessionID: string, modelId: ModelId): Promise<void> {
    const state = await ensureClient(sessionID)
    if (!state.models?.availableModels?.some((m) => m.modelId === modelId)) {
      throw new Error(`Model not available for agent ${state.agent.name}: ${modelId}`)
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

    const env: Record<string, string> = {}
    for (const key of agent.envRequired ?? []) {
      const value = process.env[key]
      if (!value) {
        throw new Error(`Missing required environment variable ${key} for agent ${agent.name}`)
      }
      env[key] = value
    }

    const client = await ACPClient.create({
      command: agent.command,
      args: agent.args,
      env,
      cwd: Instance.directory,
      onSessionUpdate: async (notification) => {
        log.info("  ┌─ [ORCHESTRATOR] received notification", {
          sessionID,
          type: notification.update.sessionUpdate,
          timestamp: new Date().toISOString()
        })
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
