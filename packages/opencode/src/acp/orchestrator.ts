import { Log } from "../util/log"
import { ACPClient } from "./client"
import { ACPTranslator } from "./translator"
import { Instance } from "../project/instance"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { Identifier } from "../id/id"
import { AuthenticationRequiredError } from "./types"

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
    client: ACPClient.Instance
    acpSessionID: string
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
    const state = await getOrCreateSession(input.sessionID)

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
      modelID: "claude-sonnet-4-5-20250929",
      providerID: "anthropic",
      mode: "build",
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
    const promptResult = await state.client.sendPrompt(state.acpSessionID, promptText)

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
   * Get or create session state, lazily spawning subprocess.
   */
  async function getOrCreateSession(sessionID: string): Promise<SessionState> {
    let state = sessions.get(sessionID)

    if (state) {
      return state
    }

    log.info("creating new ACP session", { sessionID })

    // Create ACP client (this spawns the subprocess)
    const client = await ACPClient.create({
      command: "claude-code-acp",
      cwd: Instance.directory,
      onSessionUpdate: async (notification) => {
        log.debug("received ACP notification", {
          sessionID,
          type: notification.update.sessionUpdate,
        })
        await ACPTranslator.translate(sessionID, notification)
      },
    })

    // Initialize ACP
    const initResult = await client.initialize()

    log.info("ACP initialized", {
      sessionID,
      agentName: initResult.agentInfo?.name,
      agentVersion: initResult.agentInfo?.version,
      authMethodsCount: initResult.authMethods?.length ?? 0,
    })

    // Create ACP session (may require authentication)
    let acpSession
    try {
      acpSession = await client.createSession()
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        log.info("authentication required, attempting to authenticate", {
          sessionID,
          authMethodsCount: error.authMethods.length,
        })

        // For now, automatically use the first auth method
        // TODO: In the future, this should prompt the user to select an auth method
        if (error.authMethods.length === 0) {
          throw new Error("Agent requires authentication but provided no auth methods")
        }

        const authMethod = error.authMethods[0]
        log.info("using auth method", {
          sessionID,
          methodId: authMethod.id,
          methodName: authMethod.name,
        })

        // If terminal-auth metadata exists, log instructions for the user
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
          // TODO: Execute the terminal command or prompt user to do so
          throw new Error(
            `Authentication required: Please run '${terminalAuth.command} ${(terminalAuth.args ?? []).join(" ")}' in your terminal`,
          )
        }

        // Attempt authentication with the selected method
        await client.authenticate(authMethod.id)

        // Retry session creation after authentication
        acpSession = await client.createSession()
      } else {
        throw error
      }
    }

    log.info("ACP session created", {
      sessionID,
      acpSessionID: acpSession.sessionId,
    })

    // Store state
    state = {
      sessionID,
      client,
      acpSessionID: acpSession.sessionId,
    }
    sessions.set(sessionID, state)

    return state
  }

  /**
   * Cleanup a session and kill its subprocess.
   */
  export async function cleanup(sessionID: string): Promise<void> {
    const state = sessions.get(sessionID)
    if (!state) return

    log.info("cleaning up ACP session", { sessionID })

    await state.client.dispose()
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
