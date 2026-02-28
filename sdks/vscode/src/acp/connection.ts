import { EventEmitter } from "events"
import { Readable, Writable } from "stream"

export interface JsonRpcMessage {
  jsonrpc: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcRequest extends JsonRpcMessage {
  id: number | string
  method: string
}

export interface JsonRpcResponse extends JsonRpcMessage {
  id: number | string
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcNotification extends JsonRpcMessage {
  method: string
  params?: unknown
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcConnectionConfig {
  defaultTimeout?: number
}

interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

export class JsonRpcConnection {
  private stdin: Writable
  private stdout: Readable
  private eventEmitter = new EventEmitter()
  private pending = new Map<number | string, PendingRequest>()
  private requestId = 0
  private buffer = ""
  private connected = true
  private disposed = false
  private config: { defaultTimeout: number }

  constructor(stdin: Writable, stdout: Readable, config?: JsonRpcConnectionConfig) {
    if (!stdin) {
      throw new Error("stdin is required")
    }
    if (!stdout) {
      throw new Error("stdout is required")
    }

    this.stdin = stdin
    this.stdout = stdout
    this.config = { defaultTimeout: config?.defaultTimeout ?? 30000 }

    this.setupStdoutHandler()
  }

  private setupStdoutHandler(): void {
    this.stdout.on("data", (data: Buffer) => {
      this.buffer += data.toString()
      this.processBuffer()
    })

    this.stdout.on("end", () => {
      this.connected = false
      this.rejectAllPending(new Error("Connection closed"))
    })

    this.stdout.on("error", (err: Error) => {
      this.eventEmitter.emit("error", err)
    })
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) {
        continue
      }
      this.processLine(line)
    }
  }

  private processLine(line: string): void {
    let message: JsonRpcMessage

    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch (err) {
      this.eventEmitter.emit("error", new Error(`Failed to parse JSON: ${err}`))
      return
    }

    if (message.jsonrpc !== "2.0") {
      this.eventEmitter.emit("error", new Error("Invalid JSON-RPC version"))
      return
    }

    this.handleMessage(message)
  }

  private handleMessage(message: JsonRpcMessage): void {
    // Response: has id and either result or error
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      this.handleResponse(message as JsonRpcResponse)
      return
    }

    // Notification: has method, no id
    if (message.method !== undefined && message.id === undefined) {
      this.handleNotification(message as JsonRpcNotification)
      return
    }

    // Request: has method and id (but we don't handle incoming requests in this implementation)
    if (message.method !== undefined && message.id !== undefined) {
      // Incoming request - not supported in this simple implementation
      this.eventEmitter.emit("error", new Error("Incoming requests not supported"))
      return
    }

    // Unknown message type
    this.eventEmitter.emit("error", new Error("Unknown message type"))
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this.pending.get(message.id)
    if (!pending) {
      this.eventEmitter.emit("error", new Error(`Received response for unknown request id: ${message.id}`))
      return
    }

    clearTimeout(pending.timeout)
    this.pending.delete(message.id)

    if (message.error) {
      const error = new Error(message.error.message || "JSON-RPC error")
      ;(error as any).code = message.error.code
      ;(error as any).data = message.error.data
      pending.reject(error)
    } else {
      pending.resolve(message)
    }
  }

  private handleNotification(message: JsonRpcNotification): void {
    this.eventEmitter.emit("notification", message)
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  sendRequest(
    request: { id?: number | string; method: string; params?: unknown },
    timeoutMs?: number,
  ): Promise<JsonRpcResponse> {
    if (this.disposed) {
      return Promise.reject(new Error("Connection disposed"))
    }
    if (!this.connected) {
      return Promise.reject(new Error("Connection not connected"))
    }

    const id = request.id ?? ++this.requestId
    const fullRequest: JsonRpcMessage = { ...request, jsonrpc: "2.0", id }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error("Request timed out"))
      }, timeoutMs ?? this.config.defaultTimeout)

      this.pending.set(id, { resolve, reject, timeout })

      const line = JSON.stringify(fullRequest) + "\n"
      this.stdin.write(line, (err) => {
        if (err) {
          clearTimeout(timeout)
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  sendNotification(method: string, params?: unknown): void {
    if (this.disposed) {
      return
    }
    if (!this.connected) {
      return
    }

    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params }
    const line = JSON.stringify(notification) + "\n"
    this.stdin.write(line)
  }

  onNotification(callback: (notification: JsonRpcNotification) => void): void {
    this.eventEmitter.on("notification", callback)
  }

  onError(callback: (error: Error) => void): void {
    this.eventEmitter.on("error", callback)
  }

  isConnected(): boolean {
    return this.connected && !this.disposed
  }

  getPendingRequestCount(): number {
    return this.pending.size
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.connected = false

    this.rejectAllPending(new Error("Connection disposed"))

    this.eventEmitter.removeAllListeners()

    // Clean up stream listeners
    this.stdout.removeAllListeners()
  }
}

export default JsonRpcConnection
