/**
 * Executor API SDK
 * 
 * Client for the Veritly Executor API which provides isolated execution
 * environments for running bash commands, Python code, and tools.
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
  mode: "firecracker"
  vmId: string
}

export interface SessionStatus {
  sessionId: string
  createdAt: number
  lastActivity: number
  mode: "firecracker"
  vmId: string
  sshPort?: number
}

export interface ExecutorHealth {
  ok: boolean
  service: string
  mode: "firecracker"
  guest: "x86_64"
  firecrackerVersion?: string
  activeSessions: number
  ready: boolean
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

  /**
   * Check executor health
   */
  async health(): Promise<ExecutorHealth> {
    const response = await fetch(`${this.baseUrl}/readyz`, { headers: this.hdr() })
    if (!response.ok) {
      throw new ExecutorError("Health check failed", "HEALTH_CHECK_FAILED", response.status)
    }
    return response.json()
  }

  /**
   * Execute a command in a session
   * Creates the session if it doesn't exist
   */
  async exec(
    sessionId: string,
    command: string,
    timeout?: number,
  ): Promise<ExecResult> {
    const url = `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/exec`
    
    log.debug("Executing command", { sessionId, command: command.slice(0, 100) })

    const response = await fetch(url, {
      method: "POST",
      headers: this.hdr({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        command,
        timeout: timeout ?? this.defaultTimeout,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new ExecutorError(
        `Execution failed: ${error}`,
        "EXECUTION_FAILED",
        response.status,
      )
    }

    return response.json()
  }

  /**
   * Get session status
   */
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

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/close`
    
    const response = await fetch(url, { method: "POST", headers: this.hdr() })
    
    if (!response.ok && response.status !== 404) {
      throw new ExecutorError("Failed to close session", "CLOSE_ERROR", response.status)
    }
  }

  /**
   * List all active sessions (admin)
   */
  async listSessions(): Promise<Array<{ id: string; createdAt: number; lastActivity: number }>> {
    const url = `${this.baseUrl}/v1/admin/sessions`
    
    const response = await fetch(url, { headers: this.hdr() })

    if (!response.ok) {
      throw new ExecutorError("Failed to list sessions", "LIST_ERROR", response.status)
    }

    const data = await response.json()
    return data.sessions
  }

  /**
   * Check if executor is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health()
      return health.ok
    } catch {
      return false
    }
  }
}

// Export singleton factory
export const Executor = {
  create(config: ExecutorConfig): ExecutorSDK {
    return new ExecutorSDK(config)
  },
}
