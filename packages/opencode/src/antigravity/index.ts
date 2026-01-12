/**
 * Antigravity Proxy Integration
 *
 * Manages the antigravity-claude-proxy for free Claude/Gemini access via Google Cloud Code.
 * The proxy provides an Anthropic-compatible API backed by Google's Antigravity service.
 */

import { spawn, type ChildProcess } from "child_process"
import { Log } from "../util/log"
import { homedir } from "os"
import { join } from "path"
import { existsSync } from "fs"

export namespace Antigravity {
  const log = Log.create({ service: "antigravity" })

  const DEFAULT_PORT = 8080
  const PROXY_PACKAGE = "antigravity-claude-proxy@latest"
  const CONFIG_DIR = join(homedir(), ".config", "antigravity-proxy")
  const ACCOUNTS_FILE = join(CONFIG_DIR, "accounts.json")

  let proxyProcess: ChildProcess | null = null

  export interface ProxyStatus {
    running: boolean
    port: number
    accounts: AccountInfo[]
    summary: string
  }

  export interface AccountInfo {
    email: string
    status: "ok" | "rate-limited" | "invalid" | "error"
    subscription?: {
      tier: string
      projectId: string | null
    }
    models: Record<
      string,
      {
        remaining: string
        remainingFraction: number
        resetTime: string | null
      }
    >
  }

  export interface HealthResponse {
    status: string
    timestamp: string
    latencyMs: number
    summary: string
    counts: {
      total: number
      available: number
      rateLimited: number
      invalid: number
    }
    accounts: Array<{
      email: string
      status: string
      lastUsed: string | null
      modelRateLimits: Record<string, any>
      models: Record<
        string,
        {
          remaining: string
          remainingFraction: number
          resetTime: string | null
        }
      >
    }>
  }

  /**
   * Check if the proxy is running on the given port
   */
  export async function isRunning(port = DEFAULT_PORT): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Get detailed status from the running proxy
   */
  export async function getStatus(port = DEFAULT_PORT): Promise<ProxyStatus | null> {
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as HealthResponse

      return {
        running: true,
        port,
        summary: data.summary,
        accounts: data.accounts.map((acc) => ({
          email: acc.email,
          status: acc.status as AccountInfo["status"],
          models: acc.models || {},
        })),
      }
    } catch (error) {
      log.error("Failed to get proxy status", { error })
      return null
    }
  }

  /**
   * Get account limits with quota information
   */
  export async function getAccountLimits(
    port = DEFAULT_PORT,
  ): Promise<{
    timestamp: string
    totalAccounts: number
    models: string[]
    accounts: Array<{
      email: string
      status: string
      subscription?: { tier: string }
      limits: Record<string, { remaining: string; remainingFraction: number; resetTime: string | null } | null>
    }>
  } | null> {
    try {
      const response = await fetch(`http://localhost:${port}/account-limits`, {
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        return null
      }

      return await response.json()
    } catch (error) {
      log.error("Failed to get account limits", { error })
      return null
    }
  }

  /**
   * Check if accounts are configured
   */
  export function hasAccounts(): boolean {
    return existsSync(ACCOUNTS_FILE)
  }

  /**
   * Start the proxy using npx
   */
  export async function start(port = DEFAULT_PORT): Promise<boolean> {
    if (await isRunning(port)) {
      log.info("Proxy already running", { port })
      return true
    }

    return new Promise((resolve) => {
      log.info("Starting antigravity proxy", { port })

      // Check if npx is available
      const npxPath = process.platform === "win32" ? "npx.cmd" : "npx"

      proxyProcess = spawn(npxPath, [PROXY_PACKAGE, "start"], {
        env: {
          ...process.env,
          PORT: String(port),
        },
        detached: true,
        stdio: "ignore",
      })

      proxyProcess.unref()

      // Wait for proxy to be ready
      let attempts = 0
      const maxAttempts = 30 // 15 seconds

      const checkReady = async () => {
        attempts++
        if (await isRunning(port)) {
          log.info("Proxy started successfully", { port })
          resolve(true)
          return
        }

        if (attempts >= maxAttempts) {
          log.error("Proxy failed to start in time")
          resolve(false)
          return
        }

        setTimeout(checkReady, 500)
      }

      setTimeout(checkReady, 1000)

      proxyProcess.on("error", (error) => {
        log.error("Failed to start proxy", { error })
        resolve(false)
      })
    })
  }

  /**
   * Stop the proxy
   */
  export async function stop(): Promise<void> {
    if (proxyProcess) {
      proxyProcess.kill()
      proxyProcess = null
      log.info("Proxy stopped")
    }
  }

  /**
   * Open the proxy WebUI for account management
   */
  export function getWebUIUrl(port = DEFAULT_PORT): string {
    return `http://localhost:${port}`
  }

  /**
   * Get the base URL for API calls (for provider config)
   */
  export function getApiBaseUrl(port = DEFAULT_PORT): string {
    return `http://localhost:${port}/v1`
  }

  /**
   * Generate the provider config for closecode.json
   */
  export function getProviderConfig(port = DEFAULT_PORT) {
    return {
      antigravity: {
        npm: "@ai-sdk/anthropic",
        name: "Antigravity (Free Claude/Gemini)",
        options: {
          baseURL: getApiBaseUrl(port),
          apiKey: "dummy",
        },
        models: {
          "claude-sonnet-4-5-thinking": {
            name: "AG Claude Sonnet 4.5 (Thinking)",
            limit: { context: 200000, output: 65536 },
            capabilities: { reasoning: true },
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
          },
          "claude-opus-4-5-thinking": {
            name: "AG Claude Opus 4.5 (Thinking)",
            limit: { context: 200000, output: 65536 },
            capabilities: { reasoning: true },
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
          },
          "claude-sonnet-4-5": {
            name: "AG Claude Sonnet 4.5",
            limit: { context: 200000, output: 65536 },
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
          },
          "gemini-3-flash": {
            name: "AG Gemini 3 Flash (Thinking)",
            limit: { context: 1000000, output: 65536 },
            capabilities: { reasoning: true },
            modalities: { input: ["text", "image", "audio", "video", "pdf"], output: ["text"] },
          },
          "gemini-3-pro-low": {
            name: "AG Gemini 3 Pro Low (Thinking)",
            limit: { context: 1000000, output: 65536 },
            capabilities: { reasoning: true },
            modalities: { input: ["text", "image", "audio", "video", "pdf"], output: ["text"] },
          },
          "gemini-3-pro-high": {
            name: "AG Gemini 3 Pro High (Thinking)",
            limit: { context: 1000000, output: 65536 },
            capabilities: { reasoning: true },
            modalities: { input: ["text", "image", "audio", "video", "pdf"], output: ["text"] },
          },
          "gemini-2.5-flash-lite": {
            name: "AG Gemini 2.5 Flash Lite",
            limit: { context: 1000000, output: 65536 },
            modalities: { input: ["text", "image", "audio", "video", "pdf"], output: ["text"] },
          },
          "gemini-2.5-pro": {
            name: "AG Gemini 2.5 Pro",
            limit: { context: 1000000, output: 65536 },
            modalities: { input: ["text", "image", "audio", "video", "pdf"], output: ["text"] },
          },
          "gemini-2.5-flash": {
            name: "AG Gemini 2.5 Flash",
            limit: { context: 1000000, output: 65536 },
            modalities: { input: ["text", "image", "audio", "video", "pdf"], output: ["text"] },
          },
        },
      },
    }
  }

  /**
   * Format quota for display
   */
  export function formatQuota(fraction: number | null): string {
    if (fraction === null) return "N/A"
    return `${Math.round(fraction * 100)}%`
  }

  /**
   * Format time until reset
   */
  export function formatResetTime(resetTime: string | null): string {
    if (!resetTime) return ""

    const resetMs = new Date(resetTime).getTime() - Date.now()
    if (resetMs <= 0) return "resetting..."

    const minutes = Math.floor(resetMs / 60000)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`
    }
    return `${minutes}m`
  }
}
