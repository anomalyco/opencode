/**
 * Antigravity Proxy Integration
 *
 * Manages the antigravity-claude-proxy for free Claude/Gemini access via Google Cloud Code.
 * The proxy provides an Anthropic-compatible API backed by Google's Antigravity service.
 */

import { spawn, exec, type ChildProcess } from "child_process"
import { Log } from "../util/log"
import { homedir } from "os"
import { join } from "path"
import { existsSync, writeFileSync, readFileSync } from "fs"

export namespace Antigravity {
  const log = Log.create({ service: "antigravity" })

  const DEFAULT_PORT = 8080
  const PROXY_PACKAGE = "antigravity-claude-proxy@latest"
  const CONFIG_DIR = join(homedir(), ".config", "antigravity-proxy")
  const ACCOUNTS_FILE = join(CONFIG_DIR, "accounts.json")
  const CLOSECODE_CONFIG_DIR = join(homedir(), ".config", "closecode")
  const ANTIGRAVITY_STATE_FILE = join(CLOSECODE_CONFIG_DIR, "antigravity-state.json")

  let proxyProcess: ChildProcess | null = null

  interface AntigravityState {
    enabled: boolean
    autoStart: boolean
    port: number
    setupComplete: boolean
  }

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

  /**
   * Get the saved state for Antigravity
   */
  export function getState(): AntigravityState {
    try {
      if (existsSync(ANTIGRAVITY_STATE_FILE)) {
        const data = readFileSync(ANTIGRAVITY_STATE_FILE, "utf-8")
        return JSON.parse(data)
      }
    } catch (error) {
      log.error("Failed to read antigravity state", { error })
    }
    return {
      enabled: false,
      autoStart: true,
      port: DEFAULT_PORT,
      setupComplete: false,
    }
  }

  /**
   * Save the state for Antigravity
   */
  export function saveState(state: Partial<AntigravityState>): void {
    try {
      const currentState = getState()
      const newState = { ...currentState, ...state }
      
      // Ensure config directory exists
      const { mkdirSync } = require("fs")
      mkdirSync(CLOSECODE_CONFIG_DIR, { recursive: true })
      
      writeFileSync(ANTIGRAVITY_STATE_FILE, JSON.stringify(newState, null, 2))
      log.info("Saved antigravity state", { state: newState })
    } catch (error) {
      log.error("Failed to save antigravity state", { error })
    }
  }

  /**
   * Check if Antigravity is enabled and should auto-start
   */
  export function shouldAutoStart(): boolean {
    const state = getState()
    return state.enabled && state.autoStart && state.setupComplete
  }

  /**
   * Open a new terminal window to run the proxy setup
   * This allows the user to interactively log in with Google
   */
  export async function openSetupTerminal(port = DEFAULT_PORT): Promise<boolean> {
    return new Promise((resolve) => {
      const platform = process.platform
      const command = `npx ${PROXY_PACKAGE} start`
      
      let terminalCmd: string | undefined
      let terminalArgs: string[] | undefined

      if (platform === "linux") {
        // Try common Linux terminal emulators
        // Check for Wayland-native terminals first (for Hyprland)
        const terminals = [
          { cmd: "foot", args: ["-e", "bash", "-c", `${command}; echo '\\nPress Enter to close...'; read`] },
          { cmd: "kitty", args: ["--hold", "-e", "bash", "-c", command] },
          { cmd: "alacritty", args: ["-e", "bash", "-c", `${command}; echo '\\nPress Enter to close...'; read`] },
          { cmd: "gnome-terminal", args: ["--", "bash", "-c", `${command}; echo '\\nPress Enter to close...'; read`] },
          { cmd: "konsole", args: ["-e", "bash", "-c", `${command}; echo '\\nPress Enter to close...'; read`] },
          { cmd: "xterm", args: ["-hold", "-e", command] },
        ]

        // Find the first available terminal
        for (const term of terminals) {
          try {
            const { execSync } = require("child_process")
            execSync(`which ${term.cmd}`, { stdio: "ignore" })
            terminalCmd = term.cmd
            terminalArgs = term.args
            break
          } catch {
            continue
          }
        }

        if (!terminalCmd || !terminalArgs) {
          log.error("No terminal emulator found")
          resolve(false)
          return
        }
      } else if (platform === "darwin") {
        // macOS - use osascript to open Terminal.app
        terminalCmd = "osascript"
        terminalArgs = [
          "-e",
          `tell application "Terminal" to do script "${command}"`,
          "-e",
          `tell application "Terminal" to activate`,
        ]
      } else if (platform === "win32") {
        // Windows - use start to open cmd
        terminalCmd = "cmd"
        terminalArgs = ["/c", "start", "cmd", "/k", command]
      } else {
        log.error("Unsupported platform for terminal launch", { platform })
        resolve(false)
        return
      }

      log.info("Opening setup terminal", { terminalCmd, terminalArgs })

      const proc = spawn(terminalCmd, terminalArgs, {
        detached: true,
        stdio: "ignore",
      })

      proc.unref()

      proc.on("error", (error) => {
        log.error("Failed to open terminal", { error })
        resolve(false)
      })

      // Terminal was spawned successfully
      setTimeout(() => resolve(true), 500)
    })
  }

  /**
   * Start the proxy in the background (for auto-start on app launch)
   * Returns true if proxy is running (either started or was already running)
   */
  export async function autoStart(port = DEFAULT_PORT): Promise<boolean> {
    if (!shouldAutoStart()) {
      return false
    }

    if (await isRunning(port)) {
      log.info("Proxy already running (auto-start check)", { port })
      return true
    }

    // Check if accounts are configured - if not, don't auto-start
    if (!hasAccounts()) {
      log.info("No accounts configured, skipping auto-start")
      return false
    }

    log.info("Auto-starting antigravity proxy", { port })
    return await start(port)
  }

  /**
   * Complete the setup process
   */
  export function completeSetup(port = DEFAULT_PORT): void {
    saveState({
      enabled: true,
      autoStart: true,
      port,
      setupComplete: true,
    })
  }

  /**
   * Disable Antigravity
   */
  export function disable(): void {
    saveState({
      enabled: false,
      autoStart: false,
      setupComplete: false,
    })
  }
}
