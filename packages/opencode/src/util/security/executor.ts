import { spawn } from "child_process"
import { PLATFORM } from "./constants"
import type { SecurityConfig } from "./config"

// TODO: This file duplicates process management logic from bash.ts (~100 lines including
// killTree, abort handling, timeout management, and process lifecycle). Consider extracting
// shared utilities to reduce duplication.

const SIGKILL_TIMEOUT_MS = 1000

// Safe environment variables to pass through to restricted user
const SAFE_ENV_VARS = [
  "PATH", // Command lookup
  "TERM", // Terminal type for formatting
  "LANG", // Primary locale setting
  "LC_CTYPE", // Character encoding (some commands check this specifically)
  "COLUMNS", // Terminal width for output formatting
  "LINES", // Terminal height for output formatting
] as const

export interface ExecuteOptions {
  cwd: string
  description?: string
  timeout?: number
  abortSignal?: AbortSignal
  onData?: (data: string) => void
}

export interface ExecuteResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  aborted: boolean
}

/**
 * Protected command executor
 *
 * Executes commands as a restricted user with no access to locked files (chmod 600).
 * Whitelisted commands run as the main user for compatibility.
 */
export class ProtectedExecutor {
  private restrictedUser: string
  private whitelistedCommands: string[]
  private mainUser: string

  constructor(config: SecurityConfig) {
    this.restrictedUser = config.restrictedUser
    this.whitelistedCommands = config.whitelistedCommands
    this.mainUser = config.mainUser
  }

  /**
   * Check if command matches any whitelisted command prefix
   * Returns the matching prefix if found, null otherwise
   */
  private isWhitelistedCommand(command: string): string | null {
    const trimmed = command.trim()

    for (const prefix of this.whitelistedCommands) {
      // Check if command matches this prefix exactly or starts with prefix + space
      if (trimmed === prefix || trimmed.startsWith(prefix + " ")) {
        return prefix
      }
    }

    return null
  }

  /**
   * Wrap whitelisted command to run as main user
   */
  private wrapWhitelistedCommand(command: string, prefix: string): string {
    // Extract arguments after the prefix
    const commandArgs = command.trim().substring(prefix.length).trim()

    // Build sudo command to run as main user
    if (commandArgs) {
      return `sudo -u ${this.mainUser} ${prefix} ${commandArgs}`
    }
    return `sudo -u ${this.mainUser} ${prefix}`
  }

  /**
   * Build isolated environment for restricted user
   */
  private buildSafeEnv(): Record<string, string> {
    const env: Record<string, string> = {}

    // Copy safe environment variables from parent process
    for (const key of SAFE_ENV_VARS) {
      const value = Bun.env[key]
      if (value) {
        env[key] = value
      }
    }

    // Set base environment (these override any parent values for security)
    env.HOME = PLATFORM.USER_HOME // Match NFSHomeDirectory from user creation
    env.USER = this.restrictedUser
    env.SHELL = PLATFORM.SHELL

    return env
  }

  /**
   * Execute command as restricted user
   */
  async execute(command: string, options: ExecuteOptions): Promise<ExecuteResult> {
    const timeout = options.timeout || 120000

    // Build safe environment
    const safeEnv = this.buildSafeEnv()

    // Wrap whitelisted commands to run as main user
    const whitelistedPrefix = this.isWhitelistedCommand(command)
    const actualCommand = whitelistedPrefix ? this.wrapWhitelistedCommand(command, whitelistedPrefix) : command

    // Set umask to create group-writable files (664 instead of 644)
    const wrappedCommand = `umask 0002; ${actualCommand}`

    const proc = spawn(
      "sudo",
      [
        "-n", // Non-interactive (requires NOPASSWD)
        "-u",
        this.restrictedUser,
        PLATFORM.SHELL,
        "--noprofile",
        "--norc",
        "-c",
        wrappedCommand,
      ],
      {
        cwd: options.cwd,
        env: safeEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    )

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let aborted = false
    let exited = false

    // Stream output
    proc.stdout?.on("data", (chunk) => {
      const data = chunk.toString()
      stdout += data
      options.onData?.(stdout + stderr)
    })

    proc.stderr?.on("data", (chunk) => {
      const data = chunk.toString()
      stderr += data
      options.onData?.(stdout + stderr)
    })

    const killTree = async () => {
      const pid = proc.pid
      if (!pid || exited) return

      if (process.platform === "win32") {
        await new Promise<void>((resolve) => {
          const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })
          killer.once("exit", resolve)
          killer.once("error", resolve)
        })
        return
      }

      try {
        process.kill(-pid, "SIGTERM")
        await new Promise((resolve) => setTimeout(resolve, SIGKILL_TIMEOUT_MS))
        if (!exited) {
          process.kill(-pid, "SIGKILL")
        }
      } catch {
        proc.kill("SIGTERM")
        await new Promise((resolve) => setTimeout(resolve, SIGKILL_TIMEOUT_MS))
        if (!exited) {
          proc.kill("SIGKILL")
        }
      }
    }

    if (options.abortSignal?.aborted) {
      aborted = true
      await killTree()
    }

    const abortHandler = () => {
      aborted = true
      void killTree()
    }

    options.abortSignal?.addEventListener("abort", abortHandler, { once: true })

    const timeoutTimer = setTimeout(() => {
      timedOut = true
      void killTree()
    }, timeout + 100)

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutTimer)
        options.abortSignal?.removeEventListener("abort", abortHandler)
      }

      proc.once("exit", () => {
        exited = true
        cleanup()
        resolve()
      })

      proc.once("error", (error) => {
        exited = true
        cleanup()
        reject(error)
      })
    })

    // Filter out cosmetic getcwd errors from stderr
    const filteredStderr = stderr
      .split("\n")
      .filter((line) => !line.includes("shell-init") && !line.includes("getcwd"))
      .join("\n")

    return {
      stdout,
      stderr: filteredStderr,
      exitCode: proc.exitCode ?? -1,
      timedOut,
      aborted,
    }
  }
}
