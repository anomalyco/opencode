import { EventEmitter } from "events"
import { JsonRpcConnection, JsonRpcResponse } from "./connection"
import {
  AcpError,
  AcpErrorCode,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionUpdate,
  CancelNotification,
  ClientInfo,
  ClientCapabilities,
} from "./protocol"

export { AcpError, AcpErrorCode } from "./protocol"
export type {
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionUpdate,
  PromptPart,
  CancelNotification,
} from "./protocol"

export enum AcpClientState {
  CREATED = "created",
  INITIALIZED = "initialized",
  DISPOSED = "disposed",
}

export interface AcpClientConfig {
  connection: JsonRpcConnection
  clientInfo: ClientInfo
  clientCapabilities?: ClientCapabilities
}

export class AcpClient {
  private connection: JsonRpcConnection
  private config: AcpClientConfig
  private state: AcpClientState = AcpClientState.CREATED
  private eventEmitter = new EventEmitter()
  private disposed = false
  private pendingOperations = new Set<{
    promise: Promise<unknown>
    reject: (reason: Error) => void
  }>()
  private abortController = new AbortController()
  private stateHistory: AcpClientState[] = [AcpClientState.CREATED]

  constructor(config: AcpClientConfig) {
    if (!config.connection) {
      throw new Error("connection is required")
    }

    this.config = config
    this.connection = config.connection

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    // Forward notifications from connection
    this.connection.onNotification((notification) => {
      this.handleNotification(notification)
    })

    // Forward errors from connection
    this.connection.onError((error) => {
      this.eventEmitter.emit("error", error)
    })
  }

  private handleNotification(notification: { method?: string; params?: unknown }): void {
    if (notification.method === "session/update") {
      const params = notification.params as { sessionId: string; update: SessionUpdate }
      if (params.sessionId && params.update) {
        this.eventEmitter.emit("sessionUpdate", params.sessionId, params.update)
      }
    }
  }

  getState(): AcpClientState {
    return this.state
  }

  async initialize(): Promise<InitializeResponse> {
    if (this.disposed) {
      throw new Error("Client disposed")
    }

    if (this.state !== AcpClientState.CREATED) {
      throw new Error("Client already initialized")
    }

    const request: InitializeRequest = {
      clientInfo: this.config.clientInfo,
      clientCapabilities: this.config.clientCapabilities ?? {},
    }

    const response = await this.sendRequest("initialize", request)
    const result = response.result as InitializeResponse

    this.state = AcpClientState.INITIALIZED
    this.stateHistory.push(this.state)
    this.eventEmitter.emit("stateChange", this.state)

    return result
  }

  async createSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    this.ensureInitialized()

    const response = await this.sendRequest("session/new", params)
    return response.result as NewSessionResponse
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    this.ensureInitialized()

    const response = await this.sendRequest("session/load", params)
    return response.result as LoadSessionResponse
  }

  async sendPrompt(params: PromptRequest): Promise<PromptResponse> {
    this.ensureInitialized()

    const response = await this.sendRequest("session/prompt", params)
    return response.result as PromptResponse
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.ensureInitialized()

    await this.sendNotification("session/cancel", params)
  }

  private ensureInitialized(): void {
    if (this.disposed) {
      throw new Error("Client disposed")
    }

    if (this.state !== AcpClientState.INITIALIZED) {
      throw new Error("Client not initialized")
    }
  }

  private async sendRequest(method: string, params?: unknown): Promise<JsonRpcResponse> {
    if (this.disposed) {
      throw new Error("Client disposed")
    }

    let rejectFn: (reason: Error) => void

    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      rejectFn = reject

      this.connection
        .sendRequest({
          method,
          params,
        })
        .then((response) => {
          resolve(response)
        })
        .catch((error) => {
          reject(error)
        })
    })

    const operation = { promise, reject: rejectFn! }
    this.pendingOperations.add(operation)

    try {
      const response = await promise
      return response
    } catch (error) {
      // Check if it's a JSON-RPC error with a code
      if (error instanceof Error && (error as any).code !== undefined) {
        const code = (error as any).code as number
        throw new AcpError(error.message, code, (error as any).data)
      }
      throw error
    } finally {
      this.pendingOperations.delete(operation)
    }
  }

  private async sendNotification(method: string, params?: unknown): Promise<void> {
    await this.connection.sendNotification({ method, params })
  }

  // Event handlers
  onSessionUpdate(callback: (sessionId: string, update: SessionUpdate) => void): void {
    this.eventEmitter.on("sessionUpdate", callback)
  }

  onError(callback: (error: Error) => void): void {
    this.eventEmitter.on("error", callback)
  }

  onStateChange(callback: (state: AcpClientState) => void): void {
    // Emit all historical states to new listener
    for (const state of this.stateHistory) {
      callback(state)
    }
    this.eventEmitter.on("stateChange", callback)
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.abortController.abort()
    this.state = AcpClientState.DISPOSED
    this.stateHistory.push(this.state)
    this.eventEmitter.emit("stateChange", this.state)

    // Reject all pending operations
    for (const op of this.pendingOperations) {
      op.reject(new Error("Client disposed"))
    }
    this.pendingOperations.clear()

    this.eventEmitter.removeAllListeners()
  }
}

export default AcpClient
