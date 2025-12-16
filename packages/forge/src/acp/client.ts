import {
  ClientSideConnection,
  type Agent,
  type Client,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type AuthMethod,
  type SessionModeState,
  type SessionModeId,
  type SetSessionModeResponse,
  type SessionModelState,
  type SetSessionModelResponse,
  type McpCapabilities,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "@agentclientprotocol/sdk"
import { Log } from "@/util/log"
import type { Subprocess } from "bun"
import { AuthenticationRequiredError } from "./types"
import { Permission } from "../permission"
import { transformMcpServers } from "./mcp-transform"

const log = Log.create({ service: "acp-client" })

export namespace ACPClient {
  /**
   * Configuration for creating an ACP client
   *
   * NOTE: claude-code-acp does NOT support loadSession capability.
   * Sessions exist only in memory during subprocess lifetime. When the subprocess
   * dies, the session is gone. This is by design for the MVP - no persistence needed.
   */
  export type Config = {
    /**
     * Path to the claude-code-acp executable
     */
    command: string
    /**
     * Arguments to pass to the subprocess
     */
    args?: string[]
    /**
     * Environment variables for the subprocess
     */
    env?: Record<string, string>
    /**
     * Current working directory
     */
    cwd: string
    /**
     * MCP configuration (optional - will be transformed for agent)
     */
    mcp?: Record<string, import("../config/config").Config.Mcp>
    /**
     * Optional abort signal to forcefully terminate the subprocess
     */
    abortSignal?: AbortSignal
    /**
     * Client capabilities to advertise
     */
    capabilities?: {
      fs?: {
        readTextFile?: boolean
        writeTextFile?: boolean
      }
    }
    /**
     * Callback for session updates (text chunks, tool calls, etc.)
     */
    onSessionUpdate?: (update: SessionNotification) => void
    /**
     * Callback for permission requests
     */
    onPermissionRequest?: (
      request: RequestPermissionRequest,
    ) => Promise<RequestPermissionResponse>
  }

  /**
   * ACP Client interface
   */
  export interface Instance {
    /**
     * Initialize the connection with the agent
     */
    initialize(): Promise<InitializeResponse>
    /**
     * Authenticate with the agent using the specified method
     */
    authenticate(methodId: string): Promise<void>
    /**
     * Get available authentication methods (populated after initialize)
     */
    getAuthMethods(): AuthMethod[]
    /**
     * Create a new session
     */
    createSession(): Promise<NewSessionResponse>
    /**
     * Send a prompt to the agent
     */
    sendPrompt(sessionId: string, text: string): Promise<PromptResponse>
    /**
     * Cancel the current prompt turn for a session.
     */
    cancel(sessionId: string): Promise<void>
    /**
     * Get the current session mode state (available modes and current mode)
     * Returns null if no session has been created yet
     */
    getModes(): SessionModeState | null
    /**
     * Get the current mode ID
     * Returns null if no session has been created yet
     */
    getCurrentMode(): SessionModeId | null
    /**
     * Set the session mode
     * @param modeId - The mode ID to switch to (must be in availableModes)
     */
    setMode(modeId: SessionModeId): Promise<SetSessionModeResponse>
    /**
     * Register a callback to be notified when the mode changes
     * @param callback - Function to call when mode changes
     */
    onModeChange(callback: (modeId: SessionModeId) => void): void
    /**
     * Get the current session model state (available models and current model)
     * Returns null if no session has been created yet or if agent doesn't support models
     */
    getModels(): SessionModelState | null
    /**
     * Get the current model ID
     * Returns null if no session has been created yet or if agent doesn't support models
     */
    getCurrentModel(): string | null
    /**
     * Set the session model
     * @param modelId - The model ID to switch to (must be in availableModels)
     */
    setModel(modelId: string): Promise<SetSessionModelResponse>
    /**
     * Register a callback to be notified when the model changes
     * @param callback - Function to call when model changes
     */
    onModelChange(callback: (modelId: string) => void): void
    /**
     * Get the underlying agent connection
     */
    get agent(): Agent
    /**
     * Check if connected
     */
    isConnected(): boolean
    /**
     * Dispose the client and cleanup resources
     */
    dispose(): Promise<void>
  }

  /**
   * Create an ACP client
   */
  export async function create(config: Config): Promise<Instance> {
    log.info("creating ACP client", { command: config.command, cwd: config.cwd })

    // Spawn the subprocess directly - we need raw access to stdin/stdout for the SDK
    let proc: Subprocess<"pipe", "pipe", "pipe">
    try {
      proc = Bun.spawn([config.command, ...(config.args ?? [])], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          ...config.env,
        },
        cwd: config.cwd,
      })

      log.info("subprocess spawned", { pid: proc.pid })

      if (config.abortSignal) {
        const abortHandler = () => {
          log.warn("aborting subprocess via signal", { pid: proc.pid })
          try {
            proc.kill("SIGKILL")
          } catch (error) {
            log.error("error killing subprocess on abort", {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        if (config.abortSignal.aborted) {
          abortHandler()
        } else {
          config.abortSignal.addEventListener("abort", abortHandler, { once: true })
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      log.error("failed to spawn subprocess", { error: err.message })
      throw err
    }

    // Handle stderr in background
    void (async () => {
      try {
        for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
          const text = new TextDecoder().decode(chunk)
          log.debug("agent stderr", { text })
        }
      } catch (error) {
        // Ignore stderr errors
      }
    })()

    // Handle process exit in background
    void (async () => {
      try {
        const exitCode = await proc.exited
        log.info("agent exited", { exitCode })
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        log.error("agent error", { error: err.message })
      }
    })()

    // Create Client implementation
    const clientImpl: Client = {
      async sessionUpdate(params: SessionNotification): Promise<void> {
        const startTime = Date.now()
        const notifType = params.update.sessionUpdate
        log.info("┌─ [NOTIFY START]", {
          type: notifType,
          sessionId: params.sessionId,
          timestamp: new Date().toISOString()
        })

        try {
          await config.onSessionUpdate?.(params)
          const duration = Date.now() - startTime
          log.info("└─ [NOTIFY END]", {
            type: notifType,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
          })
        } catch (error) {
          const duration = Date.now() - startTime
          log.error("└─ [NOTIFY ERROR]", {
            type: notifType,
            duration: `${duration}ms`,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
          throw error
        }
      },

      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        log.info("permission request", {
          sessionId: params.sessionId,
          toolCallId: params.toolCall.toolCallId,
          title: params.toolCall.title,
        })

        if (config.onPermissionRequest) {
          return await config.onPermissionRequest(params)
        }

        // Use Permission.ask() system to prompt user
        try {
          await Permission.ask({
            type: "acp_tool",
            pattern: params.toolCall.kind || params.toolCall.title || "tool",
            sessionID: params.sessionId,
            messageID: "", // ACP doesn't provide messageID in permission request
            callID: params.toolCall.toolCallId,
            title: params.toolCall.title || "Tool permission required",
            metadata: {
              toolCall: params.toolCall,
              options: params.options,
            },
          })

          // Permission granted - find appropriate allow option
          // TODO: Track if user selected "always" to return allow_always
          // For now, return allow_once
          const allowOption = params.options.find(o => o.kind === "allow_once") || params.options.find(o => o.kind === "allow_always")
          return {
            outcome: {
              outcome: "selected",
              optionId: allowOption?.optionId || "allow_once",
            },
          }
        } catch (error) {
          // Permission rejected (RejectedError thrown) - find appropriate reject option
          log.warn("permission rejected", { error })
          const rejectOption = params.options.find(o => o.kind === "reject_once") || params.options.find(o => o.kind === "reject_always")
          return {
            outcome: {
              outcome: "selected",
              optionId: rejectOption?.optionId || "reject_once",
            },
          }
        }
      },
    }

    // Convert Bun streams to Web streams for ndJsonStream
    // Bun's proc.stdout is already a ReadableStream
    // Bun's proc.stdin is a FileSink (WritableStreamSink) that we need to wrap

    // Create a WritableStream that writes to proc.stdin
    const stdinWritable = new WritableStream<Uint8Array>({
      write(chunk) {
        proc.stdin.write(chunk)
      },
      close() {
        proc.stdin.end()
      },
      abort(reason) {
        proc.stdin.end()
      },
    })

    // proc.stdout is already a ReadableStream
    const stdoutReadable = proc.stdout

    // Create the stream for bidirectional communication
    // ndJsonStream expects: output (where we write), input (where we read)
    const stream = ndJsonStream(stdinWritable, stdoutReadable)

    // Create the client-side connection
    const connection = new ClientSideConnection((_agent: Agent) => clientImpl, stream)

    log.info("connection created")

    // Track initialization state
    let initialized = false
    let currentSessionId: string | undefined
    let authMethods: AuthMethod[] = []
    let mcpCapabilities: McpCapabilities | undefined
    let currentModes: SessionModeState | null = null
    const modeChangeCallbacks: Array<(modeId: SessionModeId) => void> = []
    let currentModels: SessionModelState | null = null
    const modelChangeCallbacks: Array<(modelId: string) => void> = []

    const instance: Instance = {
      async initialize(): Promise<InitializeResponse> {
        if (initialized) {
          throw new Error("Already initialized")
        }

        log.info("initializing connection")

        const request: InitializeRequest = {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: config.capabilities?.fs ?? {},
          },
        }

        log.info("sending initialize request", {
          capabilities: request.clientCapabilities,
        })

        const response = await connection.initialize(request)
        initialized = true

        // Store auth methods and MCP capabilities from response
        authMethods = response.authMethods ?? []
        mcpCapabilities = response.agentCapabilities?.mcpCapabilities

        log.info("initialized", {
          protocolVersion: response.protocolVersion,
          agentName: response.agentInfo?.name,
          agentVersion: response.agentInfo?.version,
          authMethodsCount: authMethods.length,
          mcpCapabilities,
        })

        return response
      },

      async authenticate(methodId: string): Promise<void> {
        if (!initialized) {
          throw new Error("Must initialize before authenticating")
        }

        // Validate methodId is in available methods
        const method = authMethods.find((m) => m.id === methodId)
        if (!method) {
          throw new Error(
            `Invalid methodId: ${methodId}. Available methods: ${authMethods.map((m) => m.id).join(", ")}`,
          )
        }

        log.info("authenticating", { methodId, methodName: method.name })

        await connection.authenticate({ methodId })

        log.info("authentication successful", { methodId })
      },

      getAuthMethods(): AuthMethod[] {
        return [...authMethods]
      },

      async createSession(): Promise<NewSessionResponse> {
        if (!initialized) {
          throw new Error("Must initialize before creating session")
        }

        log.info("creating session", { cwd: config.cwd })

        // Transform MCP configuration to ACP format (if provided)
        const mcpServers = transformMcpServers(config.mcp, mcpCapabilities)

        log.info("transformed MCP servers", {
          count: mcpServers.length,
          servers: mcpServers.map((s) => s.name),
        })

        const request: NewSessionRequest = {
          cwd: config.cwd,
          mcpServers,
        }

        try {
          const response = await connection.newSession(request)
          currentSessionId = response.sessionId

          // Store mode state from response
          if (response.modes) {
            currentModes = response.modes
            log.info("session modes captured", {
              currentMode: currentModes.currentModeId,
              availableModes: currentModes.availableModes.map(m => m.id),
            })
          }

          // Store model state from response
          if (response.models) {
            currentModels = response.models
            log.info("session models captured", {
              currentModel: currentModels.currentModelId,
              availableModels: currentModels.availableModels.map(m => m.modelId),
            })
          }

          log.info("session created", { sessionId: response.sessionId })

          return response
        } catch (error) {
          // Check if this is an auth_required error (JSON-RPC error code -32000)
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === -32000
          ) {
            log.warn("authentication required", { authMethodsCount: authMethods.length })
            throw new AuthenticationRequiredError(
              "Agent requires authentication. Call authenticate() with a valid methodId.",
              authMethods,
            )
          }
          throw error
        }
      },

      async sendPrompt(sessionId: string, text: string): Promise<PromptResponse> {
        if (!initialized) {
          throw new Error("Must initialize before sending prompts")
        }

        log.info("sending prompt", { sessionId, textLength: text.length })

        const request: PromptRequest = {
          sessionId,
          prompt: [
            {
              type: "text",
              text,
            },
          ],
        }

        const response = await connection.prompt(request)

        log.info("prompt completed", { sessionId, stopReason: response.stopReason })

        return response
      },

      async cancel(sessionId: string): Promise<void> {
        if (!initialized) {
          throw new Error("Must initialize before cancelling session")
        }
        if (!currentSessionId) {
          throw new Error("Must create session before cancelling")
        }

        log.info("sending cancel", { sessionId })

        await connection.cancel({
          sessionId,
        })
      },

      getModes(): SessionModeState | null {
        return currentModes
      },

      getCurrentMode(): SessionModeId | null {
        return currentModes?.currentModeId ?? null
      },

      async setMode(modeId: SessionModeId): Promise<SetSessionModeResponse> {
        if (!initialized) {
          throw new Error("Must initialize before setting mode")
        }
        if (!currentSessionId) {
          throw new Error("Must create session before setting mode")
        }

        log.info("setting mode", { sessionId: currentSessionId, modeId })

        const response = await connection.setSessionMode({
          sessionId: currentSessionId,
          modeId,
        })

        // Update local state
        if (currentModes) {
          currentModes = { ...currentModes, currentModeId: modeId }
        }

        // Trigger callbacks
        modeChangeCallbacks.forEach(cb => {
          try {
            cb(modeId)
          } catch (error) {
            log.error("mode change callback error", {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        })

        log.info("mode changed", { modeId })

        return response
      },

      onModeChange(callback: (modeId: SessionModeId) => void): void {
        modeChangeCallbacks.push(callback)
      },

      getModels(): SessionModelState | null {
        return currentModels
      },

      getCurrentModel(): string | null {
        return currentModels?.currentModelId ?? null
      },

      async setModel(modelId: string): Promise<SetSessionModelResponse> {
        if (!initialized) {
          throw new Error("Must initialize before setting model")
        }
        if (!currentSessionId) {
          throw new Error("Must create session before setting model")
        }

        log.info("setting model", { sessionId: currentSessionId, modelId })

        const response = await connection.setSessionModel({
          sessionId: currentSessionId,
          modelId,
        })

        // Update local state
        if (currentModels) {
          currentModels = { ...currentModels, currentModelId: modelId }
        }

        // Trigger callbacks
        modelChangeCallbacks.forEach(cb => {
          try {
            cb(modelId)
          } catch (error) {
            log.error("model change callback error", {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        })

        log.info("model changed", { modelId })

        return response
      },

      onModelChange(callback: (modelId: string) => void): void {
        modelChangeCallbacks.push(callback)
      },

      get agent(): Agent {
        return connection
      },

      isConnected(): boolean {
        return initialized && !connection.signal.aborted
      },

      async dispose(): Promise<void> {
        log.info("disposing client")
        try {
          proc.kill("SIGTERM")
          await Bun.sleep(200)
          if (!proc.killed) {
            proc.kill("SIGKILL")
          }
        } catch (error) {
          log.error("error killing subprocess", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    }

    return instance
  }
}
