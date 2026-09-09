import { spawn } from "node:child_process"
import { Readable, Writable } from "node:stream"
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ContentBlock,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk"
import type { ConfigBackendV1 } from "@opencode-ai/core/v1/config/backend"
import { Process } from "@/util/process"

export class DSHError extends Error {
  constructor(message: string) {
    super(`DSH backend: ${message}`)
    this.name = "DSHError"
  }
}

/** An owned ACP process. Remote errors and stderr are deliberately excluded from diagnostics. */
export class DSHClient {
  private readonly child
  private readonly connection
  private readonly exited: Promise<void>
  private readonly dead: Promise<never>
  private readonly ready: Promise<void>
  private readonly sessions = new Set<string>()
  private updates = Promise.resolve()
  private updateError: unknown
  private closing?: Promise<void>
  private stopped = false
  private cleanupError?: Error
  private readonly timeout: number
  private readonly shutdown: number

  constructor(
    config: ConfigBackendV1.DSH,
    private readonly cwd: string,
    handlers: {
      update: (event: SessionNotification) => Promise<void>
      permission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
    },
  ) {
    this.timeout = config.startup_timeout ?? 30_000
    this.shutdown = config.shutdown_timeout ?? 5_000
    this.child = spawn(config.command[0], config.command.slice(1), {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
      detached: process.platform !== "win32",
      windowsHide: true,
    })
    this.exited = new Promise<void>((resolve) => {
      this.child.once("exit", () => {
        this.stopped = true
        // A crashed group leader can leave tool descendants alive with inherited pipes.
        if (process.platform !== "win32" && this.child.pid !== undefined) {
          try {
            process.kill(-this.child.pid, "SIGKILL")
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
              this.cleanupError = new DSHError("could not terminate the owned runtime process group.")
            }
          }
        }
        resolve()
      })
      this.child.once("error", () => {
        // A spawn error has no process to reap. Runtime errors still require exit.
        if (this.child.pid !== undefined) return
        this.stopped = true
        resolve()
      })
    })
    this.dead = this.exited.then(() => {
      throw new DSHError("runtime exited; check backend.command and DSH configuration. No prompt was retried.")
    })
    void this.dead.catch(() => {})
    this.connection = new ClientSideConnection(
      () => ({
        sessionUpdate: (event) => {
          this.updates = this.updates.then(() => handlers.update(event)).catch((error: unknown) => {
            this.updateError ??= error
          })
          return this.updates
        },
        requestPermission: async (request) => {
          await this.updates
          if (this.updateError || this.closing) return { outcome: { outcome: "cancelled" } }
          return handlers.permission(request)
        },
      }),
      // Node and Bun declare different BYOB overloads for the same Web Streams implementation.
      ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout) as unknown as ReadableStream<Uint8Array>),
    )
    this.ready = this.request("initialize", async () => {
      const result = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "opencode-dsh-backend", version: "1" },
        clientCapabilities: {},
      })
      if (result.protocolVersion !== PROTOCOL_VERSION || result.agentInfo?.name !== "deepseek-harness-acp") {
        throw new DSHError("incompatible runtime; backend.command must launch dsh --profile acp.")
      }
      if (!result.agentCapabilities?.sessionCapabilities?.resume || !result.agentCapabilities.sessionCapabilities.close) {
        throw new DSHError("runtime must support ACP session/resume and session/close; update DSH.")
      }
    })
    void this.ready.catch(() => {})
  }

  get pid() {
    return this.child.pid
  }

  get alive() {
    return !this.stopped && !this.closing && !this.connection.signal.aborted
  }

  async session(id?: string): Promise<string> {
    await this.ready
    if (id && this.sessions.has(id)) return id
    if (id) {
      await this.request("session/resume", () => this.connection.resumeSession({ sessionId: id, cwd: this.cwd, mcpServers: [] }))
      this.sessions.add(id)
      return id
    }
    const result = await this.request("session/new", () => this.connection.newSession({ cwd: this.cwd, mcpServers: [] }))
    this.sessions.add(result.sessionId)
    return result.sessionId
  }

  async prompt(sessionId: string, prompt: ContentBlock[]) {
    await this.ready
    const result = await this.request("session/prompt", () => this.connection.prompt({ sessionId, prompt }), 0)
    await this.updates
    if (this.updateError instanceof DSHError) throw this.updateError
    if (this.updateError) throw new DSHError("could not project runtime output. The prompt was not retried.")
    return result
  }

  /**
   * Apply one ACP session configuration option before the next prompt.
   *
   * @param sessionId - The owned DSH session.
   * @param configId - ACP configuration option identifier.
   * @param value - Opaque select value returned by the runtime.
   * @returns The complete configuration state after the update.
   */
  async setConfigOption(sessionId: string, configId: string, value: string): Promise<SessionConfigOption[]> {
    await this.ready
    const result = await this.request(
      "session/set_config_option",
      () => this.connection.setSessionConfigOption({ sessionId, configId, value }),
    )
    return result.configOptions
  }

  async cancel(sessionId: string) {
    await this.request("session/cancel", () => this.connection.cancel({ sessionId }), this.shutdown)
  }

  close(): Promise<void> {
    return (this.closing ??= this.dispose())
  }

  private async dispose() {
    if (this.stopped) {
      if (this.cleanupError) throw this.cleanupError
      return
    }
    // Close each known session so DSH cancels work and flushes persistence before EOF.
    await bounded(
      Promise.all([...this.sessions].map((sessionId) => this.connection.closeSession({ sessionId }))),
      this.shutdown,
    ).catch(() => {})
    this.child.stdin.end()
    if (await this.waitExit()) return
    await this.kill("SIGTERM")
    if (await this.waitExit()) return
    await this.kill("SIGKILL")
    if (!(await this.waitExit())) throw new DSHError("runtime did not exit after SIGKILL; process ownership is retained.")
  }

  private async waitExit() {
    const exited = await bounded(this.exited.then(() => true), this.shutdown).catch(() => false)
    if (exited && this.cleanupError) throw this.cleanupError
    return exited
  }

  private async kill(signal: NodeJS.Signals) {
    if (this.stopped || this.child.pid === undefined) return
    if (process.platform === "win32") {
      await Process.stop(this.child)
      return
    }
    try {
      process.kill(-this.child.pid, signal)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
    }
  }

  private async request<T>(method: string, run: () => Promise<T>, timeout = this.timeout): Promise<T> {
    try {
      const result = Promise.race([run(), this.dead, this.connection.closed.then(() => {
        throw new DSHError("runtime connection closed; verify DSH configuration. No prompt was retried.")
      })])
      return await (timeout ? bounded(result, timeout) : result)
    } catch (error) {
      if (error instanceof DSHError) throw error
      throw new DSHError(`${method} failed; verify the DSH profile, credentials, and saved session. No prompt was retried.`)
    }
  }
}

async function bounded<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DSHError("runtime request timed out; verify backend.command and DSH configuration.")), timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
