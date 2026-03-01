import { spawn, ChildProcess } from "child_process"
import { EventEmitter } from "events"

export enum ProcessState {
  STOPPED = "stopped",
  STARTING = "starting",
  RUNNING = "running",
  CRASHED = "crashed",
  FAILED = "failed",
}

export interface AcpProcessConfig {
  cwd: string
  env?: NodeJS.ProcessEnv
  maxRestarts?: number
  restartDelay?: number
  healthCheckTimeout?: number
  stopTimeout?: number
}

export interface SpawnOptions {
  command: string
  args: string[]
}

export interface JsonRpcMessage {
  jsonrpc: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

export class AcpProcess {
  private config: Required<AcpProcessConfig>
  private process: ChildProcess | null = null
  private state: ProcessState = ProcessState.STOPPED
  private restartCount = 0
  private restartTimeout: NodeJS.Timeout | null = null
  private pendingRequests = new Map<
    number | string,
    { resolve: (value: JsonRpcMessage) => void; reject: (reason: Error) => void; timeout: NodeJS.Timeout }
  >()
  private requestId = 0
  private eventEmitter = new EventEmitter()
  private stdoutBuffer = ""
  private stderrBuffer = ""
  private stopRequested = false

  constructor(config: AcpProcessConfig) {
    if (!config.cwd) throw new Error("cwd is required")

    this.config = {
      cwd: config.cwd,
      env: config.env ?? process.env,
      maxRestarts: config.maxRestarts ?? 5,
      restartDelay: config.restartDelay ?? 1000,
      healthCheckTimeout: config.healthCheckTimeout ?? 30000,
      stopTimeout: config.stopTimeout ?? 5000,
    }
  }

  getState(): ProcessState {
    return this.state
  }

  getProcess(): ChildProcess | null {
    return this.process
  }

  getRestartCount(): number {
    return this.restartCount
  }

  async start(options: SpawnOptions): Promise<void> {
    if (this.state === ProcessState.RUNNING || this.state === ProcessState.STARTING) {
      throw new Error("Process is already running")
    }

    this.state = ProcessState.STARTING
    this.stopRequested = false

    try {
      this.process = spawn(options.command, options.args, {
        cwd: this.config.cwd,
        env: this.config.env,
        stdio: ["pipe", "pipe", "pipe"],
      })

      this.setupProcessHandlers(options)
      this.setupStdioHandlers()

      // Wait for process to be ready
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          cleanup()
          resolve()
        }

        const onError = (err: Error) => {
          cleanup()
          reject(err)
        }

        const cleanup = () => {
          this.process?.removeListener("spawn", onSpawn)
          this.process?.removeListener("error", onError)
        }

        this.process?.once("spawn", onSpawn)
        this.process?.once("error", onError)
      })

      this.state = ProcessState.RUNNING
      this.eventEmitter.emit("spawn")
    } catch (error) {
      this.state = ProcessState.FAILED
      this.eventEmitter.emit("error", error)
      throw error
    }
  }

  private setupProcessHandlers(options: SpawnOptions): void {
    if (!this.process) return

    this.process.on("exit", (code, signal) => {
      this.handleExit(code, signal, options)
    })

    this.process.on("error", (error) => {
      this.handleError(error, options)
    })
  }

  private setupStdioHandlers(): void {
    if (!this.process) return

    // Handle stdout
    this.process.stdout?.on("data", (data: Buffer) => {
      this.stdoutBuffer += data.toString()
      this.processStdoutBuffer()
    })

    // Handle stderr
    this.process.stderr?.on("data", (data: Buffer) => {
      const str = data.toString()
      this.stderrBuffer += str
      this.eventEmitter.emit("stderr", str)
    })
  }

  private processStdoutBuffer(): void {
    const lines = this.stdoutBuffer.split("\n")
    this.stdoutBuffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const message = JSON.parse(line) as JsonRpcMessage
        this.handleJsonRpcMessage(message)
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  private handleJsonRpcMessage(message: JsonRpcMessage): void {
    // Handle responses
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(message.id)

        if (message.error) {
          pending.reject(new Error(JSON.stringify(message.error)))
        } else {
          pending.resolve(message)
        }
      }
    }
  }

  private handleExit(code: number | null, signal: string | null, options: SpawnOptions): void {
    this.eventEmitter.emit("exit", code)

    if (this.stopRequested) {
      this.cleanup()
      this.state = ProcessState.STOPPED
      return
    }

    // Process crashed or exited unexpectedly
    if (code !== 0 || signal) {
      this.state = ProcessState.CRASHED
      this.eventEmitter.emit("crash")

      if (this.restartCount < this.config.maxRestarts) {
        this.scheduleRestart(options)
      } else {
        this.state = ProcessState.FAILED
        this.eventEmitter.emit("error", new Error(`Process failed after ${this.config.maxRestarts} restarts`))
      }
    } else {
      this.cleanup()
      this.state = ProcessState.STOPPED
    }
  }

  private handleError(error: Error, options: SpawnOptions): void {
    this.state = ProcessState.CRASHED
    this.eventEmitter.emit("error", error)

    if (this.restartCount < this.config.maxRestarts && !this.stopRequested) {
      this.scheduleRestart(options)
    } else {
      this.state = ProcessState.FAILED
    }
  }

  private scheduleRestart(options: SpawnOptions): void {
    this.restartCount++
    const delay = this.config.restartDelay * Math.pow(2, this.restartCount - 1)

    this.restartTimeout = setTimeout(
      async () => {
        this.eventEmitter.emit("restart")
        await this.start(options).catch((err) => {
          this.eventEmitter.emit("error", err)
        })
      },
      Math.min(delay, 30000),
    ) // Cap at 30 seconds
  }

  async stop(): Promise<void> {
    if (this.state === ProcessState.STOPPED || this.state === ProcessState.FAILED) {
      this.cleanup()
      return
    }

    this.stopRequested = true

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout)
      this.restartTimeout = null
    }

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("Process stopped"))
    }
    this.pendingRequests.clear()

    if (!this.process) {
      this.state = ProcessState.STOPPED
      return
    }

    // Try graceful shutdown first
    const gracefulTimeout = this.config.stopTimeout
    const killTimeout = 1000

    await new Promise<void>((resolve) => {
      let resolved = false

      const cleanupAndResolve = () => {
        if (!resolved) {
          resolved = true
          this.cleanup()
          resolve()
        }
      }

      // Listen for exit
      this.process?.once("exit", cleanupAndResolve)

      // Send SIGTERM
      this.process?.kill("SIGTERM")

      // Force kill after timeout
      setTimeout(() => {
        this.process?.kill("SIGKILL")
        setTimeout(cleanupAndResolve, killTimeout)
      }, gracefulTimeout)
    })

    this.state = ProcessState.STOPPED
  }

  private cleanup(): void {
    if (this.process) {
      this.process.removeAllListeners()
      this.process = null
    }
    this.stdoutBuffer = ""
    this.stderrBuffer = ""
  }

  async sendRequest(message: Omit<JsonRpcMessage, "jsonrpc">, timeoutMs?: number): Promise<JsonRpcMessage> {
    if (this.state !== ProcessState.RUNNING) {
      throw new Error("Process is not running")
    }

    if (!this.process?.stdin?.writable) {
      throw new Error("Process stdin is not writable")
    }

    const id = message.id ?? ++this.requestId
    const fullMessage = { ...message, jsonrpc: "2.0", id }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error("Request timed out"))
      }, timeoutMs ?? 30000)

      this.pendingRequests.set(id, { resolve, reject, timeout })

      const line = JSON.stringify(fullMessage) + "\n"
      this.process!.stdin!.write(line, (err) => {
        if (err) {
          clearTimeout(timeout)
          this.pendingRequests.delete(id)
          reject(err)
        }
      })
    })
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.sendRequest(
        {
          method: "initialize",
          params: { protocolVersion: 1 },
        },
        this.config.healthCheckTimeout,
      )
      return !!response.result
    } catch {
      return false
    }
  }

  // Event handlers
  onSpawn(callback: () => void): void {
    this.eventEmitter.on("spawn", callback)
  }

  onExit(callback: (code: number | null) => void): void {
    this.eventEmitter.on("exit", callback)
  }

  onCrash(callback: () => void): void {
    this.eventEmitter.on("crash", callback)
  }

  onError(callback: (error: Error) => void): void {
    this.eventEmitter.on("error", callback)
  }

  onRestart(callback: () => void): void {
    this.eventEmitter.on("restart", callback)
  }

  onStderr(callback: (data: string) => void): void {
    this.eventEmitter.on("stderr", callback)
  }
}
