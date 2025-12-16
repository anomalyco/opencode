import type { ACPAgentDefinition } from "./agents"
import { ACPClient } from "./client"
import { ACPAuthManager } from "./auth"
import type { AuthMethod, SessionModeState, SessionModelState } from "@agentclientprotocol/sdk"
import { Log } from "@/util/log"

const log = Log.create({ service: "acp-connection" })

/**
 * Result of a successful agent connection
 */
export interface AgentConnectionResult {
  client: ACPClient.Instance
  sessionId: string
  modes: SessionModeState | null
  models: SessionModelState | null
  authMethods: AuthMethod[]
}

/**
 * Options for connecting to an agent
 */
export interface AgentConnectionOptions {
  agentDef: ACPAgentDefinition
  cwd: string
  /** MCP configuration to pass to the agent */
  mcp?: Record<string, import("../config/config").Config.Mcp>
  /** Abort signal to cancel connection attempt and kill subprocess */
  abortSignal?: AbortSignal
  /** Existing client to dispose before connecting (for reconnection scenarios) */
  existingClient?: ACPClient.Instance | null
  /** Version number for race condition handling */
  version?: number
  /** Callback to check if connection is stale (returns true if should abort) */
  onStaleCheck?: (currentVersion: number) => boolean
  /** Callback to prompt user to select auth method */
  onSelectAuthMethod?: (methods: AuthMethod[]) => Promise<AuthMethod | null>
}

/**
 * Custom error for installation issues
 */
export class AgentNotInstalledError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly installGuide?: string
  ) {
    super(`Agent ${agentName} is not installed`)
    this.name = "AgentNotInstalledError"
  }
}

/**
 * Custom error for connection abortion (due to race condition)
 */
export class ConnectionAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConnectionAbortedError"
  }
}

/**
 * Manages the complete lifecycle of connecting to an ACP agent
 *
 * Handles:
 * - Installation validation
 * - Client lifecycle (dispose → create → initialize → authenticate → create session)
 * - Race condition detection
 * - Error handling and cleanup
 */
export class AgentConnector {
  /**
   * Validates that an agent is installed
   */
  static validateInstallation(agentDef: ACPAgentDefinition): void {
    const resolved = Bun.which(agentDef.command)
    if (!resolved) {
      throw new AgentNotInstalledError(agentDef.name, agentDef.installGuide)
    }
  }

  /**
   * Connects to an ACP agent
   *
   * This is the main entry point for establishing a connection to an agent.
   * It orchestrates the entire connection flow and handles cleanup on errors.
   *
   * @param options - Connection options
   * @returns Connection result with client and session info
   * @throws {AgentNotInstalledError} If system agent is not installed
   * @throws {ConnectionAbortedError} If connection is aborted due to race condition
   * @throws {Error} For other connection failures
   */
  static async connect(
    options: AgentConnectionOptions
  ): Promise<AgentConnectionResult> {
    const { agentDef, cwd, mcp, existingClient, version = 0, onStaleCheck, abortSignal, onSelectAuthMethod } = options

    log.debug("agent.connect.start", { agent: agentDef.name })

    // Validate installation
    this.validateInstallation(agentDef)

    // Dispose existing client if any
    if (existingClient) {
      log.debug("agent.connect.disposingExisting")
      await existingClient.dispose()
    }

    let client: ACPClient.Instance | null = null

    try {
      // Create ACP client
      client = await ACPClient.create({
        command: agentDef.command,
        args: agentDef.acpStartupArgs,
        cwd,
        mcp,
        abortSignal,
        capabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false,
          },
        },
      })
      log.debug("agent.connect.created", { agent: agentDef.name })

      // Initialize
      const initResp = await client.initialize()

      // Check if connection is stale
      if (onStaleCheck?.(version)) {
        log.debug("agent.connect.staleAfterInit", { agent: agentDef.name })
        await client.dispose()
        throw new ConnectionAbortedError("Connection aborted: stale after initialization")
      }

      log.debug("agent.connect.initialized", { agent: agentDef.name })

      // Store auth methods for later use
      const authMethods = initResp.authMethods ?? []

      // Try to create session - only authenticate if it fails with auth error
      let sessionResp: Awaited<ReturnType<typeof client.createSession>>
      try {
        sessionResp = await client.createSession()
      } catch (error: unknown) {
        // Check if this is an auth error
        const isAuthError = ACPAuthManager.isAuthError(error)
        if (isAuthError.isAuthError && authMethods.length > 0) {
          // Authentication required - prompt user to select method
          if (!onSelectAuthMethod) {
            throw new Error(
              `Agent ${agentDef.name} requires authentication but no auth method selection callback was provided`
            )
          }
          await ACPAuthManager.attemptAuth(client, authMethods, onSelectAuthMethod)

          // Retry creating session after authentication
          sessionResp = await client.createSession()
        } else {
          // Not an auth error, or no auth methods available - rethrow
          throw error
        }
      }

      // Check if connection is stale
      if (onStaleCheck?.(version)) {
        log.debug("agent.connect.staleAfterSession", { agent: agentDef.name })
        await client.dispose()
        throw new ConnectionAbortedError("Connection aborted: stale after session creation")
      }

      log.debug("agent.connect.sessionCreated", {
        agent: agentDef.name,
        sessionId: sessionResp.sessionId,
        modes: sessionResp.modes?.availableModes?.length,
        models: sessionResp.models?.availableModels?.length,
      })

      // Clone modes and models to strip readonly property descriptors from SDK responses
      // This allows Solid's reconcile() to work correctly when storing in reactive stores
      // Note: Using JSON parse/stringify instead of structuredClone because structuredClone
      // can preserve property descriptors in some cases
      const modes = sessionResp.modes ? JSON.parse(JSON.stringify(sessionResp.modes)) : null
      const models = sessionResp.models ? JSON.parse(JSON.stringify(sessionResp.models)) : null

      log.debug("agent.connect.modesCloned", {
        agent: agentDef.name,
        hasModesoriginal: !!sessionResp.modes,
        hasModesCloned: !!modes,
        modesDescriptor: modes ? Object.getOwnPropertyDescriptor(modes, 'currentModeId') : null
      })

      return {
        client,
        sessionId: sessionResp.sessionId,
        modes,
        models,
        authMethods,
      }
    } catch (error) {
      // Clean up client on error
      if (client) {
        log.debug("agent.connect.cleanupOnError", { agent: agentDef.name })
        await client.dispose().catch((disposeError) => {
          log.error("agent.connect.disposeError", {
            agent: agentDef.name,
            error: disposeError instanceof Error ? disposeError.message : String(disposeError),
          })
        })
      }
      throw error
    }
  }
}
