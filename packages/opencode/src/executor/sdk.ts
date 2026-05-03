/**
 * Executor API SDK — isolated MicroPython sessions on the executor host.
 */

import { Log } from "../util/log"

const log = Log.create({ service: "executor-sdk" })

export interface ExecutorConfig {
  baseUrl: string
  timeout?: number
  /**
   * Override HTTP `Host` (e.g. when `baseUrl` points at an in-cluster Ingress VIP and rules match this host).
   * Also read from env `VERITLY_EXECUTOR_HTTP_HOST`.
   */
  httpHost?: string
}

export interface ExecResult {
  output: string
  exitCode: number
  sessionId: string
  mode: "micropython"
}

export interface SessionStatus {
  sessionId: string
  createdAt: number
  lastActivity: number
  mode: "micropython"
}

export type ExecutorReadyzStatic = {
  micropythonBin: string
  micropythonRunnable: boolean
  micropythonVersion: string | null
  libPath: string
  libReadable: boolean
  probeExit: number | null
  probeOutput: string | null
}

/** Same JSON as `GET /readyz`: MicroPython binary, bundle import probe. */
export interface ExecutorHealth {
  ok: boolean
  service: "executor"
  mode: "micropython"
  cached: boolean
  cachedAgeMs?: number
  activeSessions: number
  static: ExecutorReadyzStatic
  errors: string[]
}

export class ExecutorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = "ExecutorError"
  }
}

export class ExecutorSDK {
  private baseUrl: string
  private defaultTimeout: number
  private httpHost?: string

  constructor(config: ExecutorConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "")
    this.defaultTimeout = config.timeout ?? 120000
    this.httpHost = config.httpHost?.trim() || process.env.VERITLY_EXECUTOR_HTTP_HOST?.trim() || undefined
  }

  private hdr(extra?: Record<string, string>): Record<string, string> {
    const out = { ...extra }
    if (this.httpHost) out.Host = this.httpHost
    return out
  }

  async health(): Promise<ExecutorHealth> {
    const response = await fetch(`${this.baseUrl}/readyz`, { headers: this.hdr() })
    if (!response.ok) {
      throw new ExecutorError("Health check failed", "HEALTH_CHECK_FAILED", response.status)
    }
    return response.json()
  }

  /**
   * Run MicroPython `code` in a session workspace (created on first use).
   */
  async exec(sessionId: string, code: string, timeout?: number, workdir?: string): Promise<ExecResult> {
    const url = `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/exec`

    log.debug("Executing MicroPython", { sessionId, preview: code.slice(0, 120) })

    const response = await fetch(url, {
      method: "POST",
      headers: this.hdr({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        code,
        timeout: timeout ?? this.defaultTimeout,
        ...(workdir !== undefined ? { workdir } : {}),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new ExecutorError(`Execution failed: ${error}`, "EXECUTION_FAILED", response.status)
    }

    return response.json()
  }

  async getSession(sessionId: string): Promise<SessionStatus> {
    const url = `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/status`

    const response = await fetch(url, { headers: this.hdr() })

    if (response.status === 404) {
      throw new ExecutorError("Session not found", "SESSION_NOT_FOUND", 404)
    }

    if (!response.ok) {
      throw new ExecutorError("Failed to get session", "SESSION_ERROR", response.status)
    }

    return response.json()
  }

  async closeSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/close`

    const response = await fetch(url, { method: "POST", headers: this.hdr() })

    if (!response.ok && response.status !== 404) {
      throw new ExecutorError("Failed to close session", "CLOSE_ERROR", response.status)
    }
  }

  async listSessions(): Promise<Array<{ id: string; createdAt: number; lastActivity: number }>> {
    const url = `${this.baseUrl}/v1/admin/sessions`

    const response = await fetch(url, { headers: this.hdr() })

    if (!response.ok) {
      throw new ExecutorError("Failed to list sessions", "LIST_ERROR", response.status)
    }

    const data = await response.json()
    return data.sessions
  }

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health()
      return health.ok
    } catch {
      return false
    }
  }
}

export const Executor = {
  create(config: ExecutorConfig): ExecutorSDK {
    return new ExecutorSDK(config)
  },
}
