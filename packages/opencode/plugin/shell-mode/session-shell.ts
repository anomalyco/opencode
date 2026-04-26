/**
 * Per-session shell process management.
 * Spawns and manages a persistent shell process for each session.
 */

import { spawn, type ChildProcess } from "child_process"
import { ulid } from "ulid"
import path from "path"
import os from "os"
import { Bus } from "@/bus"
import { SessionStatus } from "@/session/status"
import * as Log from "@/util/log"
import { Shell } from "@/shell/shell"
import { getCwd, setCwd } from "./cwd"

const log = Log.create({ service: "session-shell" })

// Idle timeout before disposing shell (2 minutes)
const IDLE_TIMEOUT_MS = 2 * 60 * 1000

export type ExecOptions = {
  sessionID: string
  command: string
  signal: AbortSignal
  onData?: (chunk: string) => void
}

export type ExecResult = {
  output: string
  exitCode: number
  cwd?: string
}

/**
 * Per-session shell process that maintains state across commands.
 */
class ShellProcess {
  private proc: ChildProcess | null = null
  private shellPath: string
  private shellName: string
  private cwd: string
  private idleTimer: NodeJS.Timeout | null = null
  private _isClosed = false

  constructor(cwd: string) {
    this.shellPath = Shell.preferred()
    this.shellName = (
      process.platform === "win32"
        ? path.win32.basename(this.shellPath, ".exe")
        : path.basename(this.shellPath)
    ).toLowerCase()
    this.cwd = cwd
  }

  get isClosed(): boolean {
    return this._isClosed
  }

  private spawn(): ChildProcess {
    if (this.proc && !this._isClosed) {
      return this.proc
    }

    const initScript = this.getInitScript()
    const args = this.getSpawnArgs(initScript)

    this.proc = spawn(this.shellPath, args, {
      cwd: this.cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TERM: "dumb",
      },
    })

    this.proc.on("close", () => {
      this._isClosed = true
      this.proc = null
    })

    this.proc.on("error", (err) => {
      log.error("shell process error", { error: err })
      this._isClosed = true
      this.proc = null
    })

    return this.proc
  }

  private getInitScript(): string {
    switch (this.shellName) {
      case "zsh":
        return `
[[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
[[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
`
      case "bash":
        return `
[[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
shopt -s expand_aliases >/dev/null 2>&1 || true
`
      default:
        return ""
    }
  }

  private getSpawnArgs(initScript: string): string[] {
    switch (this.shellName) {
      case "zsh":
      case "bash":
        return ["-i"]
      case "fish":
        return ["-i"]
      case "nu":
        return ["-i"]
      case "cmd":
        return ["/Q", "/K"]
      case "powershell":
      case "pwsh":
        return ["-NoLogo", "-NoExit"]
      default:
        return []
    }
  }

  /**
   * Execute a command and return the result.
   * Wraps the command to capture exit code and working directory.
   */
  async execute(options: ExecOptions): Promise<ExecResult> {
    const { command, signal, onData } = options
    const sentinel = `__OPENCODE_DONE__${ulid()}__:`

    const proc = this.spawn()
    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      throw new Error("Shell process streams not available")
    }

    return new Promise<ExecResult>((resolve, reject) => {
      let output = ""
      let resolved = false

      const cleanup = () => {
        proc.stdout?.off("data", onStdout)
        proc.stderr?.off("data", onStderr)
        signal.removeEventListener("abort", onAbort)
      }

      const onStdout = (chunk: Buffer) => {
        const text = chunk.toString()

        // Check for sentinel
        const sentinelIndex = text.indexOf(sentinel)
        if (sentinelIndex !== -1) {
          // Extract output before sentinel
          const beforeSentinel = text.slice(0, sentinelIndex)
          output += beforeSentinel
          onData?.(beforeSentinel)

          // Parse exit code and cwd from sentinel line
          const afterSentinel = text.slice(sentinelIndex + sentinel.length)
          const parts = afterSentinel.trim().split("\t")
          const exitCode = parseInt(parts[0], 10) || 0
          const cwd = parts[1] || undefined

          resolved = true
          cleanup()
          resolve({ output: output.trim(), exitCode, cwd })
          return
        }

        output += text
        onData?.(text)
      }

      const onStderr = (chunk: Buffer) => {
        const text = chunk.toString()
        output += text
        onData?.(text)
      }

      const onAbort = () => {
        if (!resolved) {
          cleanup()
          // Send SIGINT to interrupt the current command
          if (proc.pid) {
            try {
              process.kill(-proc.pid, "SIGINT")
            } catch {
              proc.kill("SIGINT")
            }
          }
          resolve({ output: output.trim() + "\n[Aborted]", exitCode: 130, cwd: undefined })
        }
      }

      proc.stdout!.on("data", onStdout)
      proc.stderr!.on("data", onStderr)
      signal.addEventListener("abort", onAbort, { once: true })

      // Write the wrapped command to capture exit code and cwd
      const wrappedCommand = this.wrapCommand(command, sentinel)
      proc.stdin!.write(wrappedCommand + "\n")
    })
  }

  private wrapCommand(command: string, sentinel: string): string {
    // Platform-specific command wrapping
    switch (this.shellName) {
      case "cmd":
        // Windows cmd doesn't support the same syntax
        return `${command} & echo ${sentinel}%ERRORLEVEL%\t%CD%`
      case "powershell":
      case "pwsh":
        // PowerShell uses backtick for escape - use \`t for tab
        return `${command}; Write-Host "${sentinel}$LASTEXITCODE\`t$(Get-Location)"`
      case "fish":
        return `${command}; echo "${sentinel}$status\t"(pwd)`
      case "nu":
        return `${command}; print $"${sentinel}($env.LAST_EXIT_CODE)\t(pwd)"`
      default:
        // POSIX shells (bash, zsh, sh, etc.)
        return `{
${command}
}
__opencode_status__=$?
__opencode_cwd__="$(pwd -P 2>/dev/null || pwd)"
printf '\\n${sentinel}%s\\t%s\\n' "$__opencode_status__" "$__opencode_cwd__"`
    }
  }

  /**
   * Dispose the shell process.
   */
  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    if (this.proc && !this._isClosed) {
      Shell.killTree(this.proc, { exited: () => this._isClosed })
      this._isClosed = true
      this.proc = null
    }
  }

  /**
   * Reset the idle timer.
   */
  resetIdleTimer(onIdle: () => void): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }
    this.idleTimer = setTimeout(onIdle, IDLE_TIMEOUT_MS)
  }
}

// Store shells per session
const shells = new Map<string, ShellProcess>()

/**
 * Get or create a shell for a session.
 */
function getShell(sessionID: string): ShellProcess {
  ensureSubscribed()
  let shell = shells.get(sessionID)
  if (!shell || shell.isClosed) {
    shell = new ShellProcess(getCwd())
    shells.set(sessionID, shell)
  }
  return shell
}

/**
 * Execute a command in the session's shell.
 */
export async function execute(options: ExecOptions): Promise<{ ok: true; result: ExecResult } | { ok: false; error: string }> {
  const { sessionID, command, signal, onData } = options

  try {
    const shell = getShell(sessionID)

    // Reset idle timer
    shell.resetIdleTimer(() => {
      dispose(sessionID)
    })

    const result = await shell.execute({ sessionID, command, signal, onData })

    // Update global cwd if changed
    if (result.cwd) {
      setCwd(result.cwd)
    }

    return { ok: true, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error("shell execution failed", { error, sessionID, command })
    return { ok: false, error: message }
  }
}

/**
 * Dispose the shell for a session.
 */
export function dispose(sessionID: string): void {
  const shell = shells.get(sessionID)
  if (shell) {
    shell.dispose()
    shells.delete(sessionID)
    log.info("disposed shell", { sessionID })
  }
}

/**
 * Dispose all shells.
 */
export function disposeAll(): void {
  for (const [sessionID, shell] of shells) {
    shell.dispose()
    log.info("disposed shell", { sessionID })
  }
  shells.clear()
}

// Lazy initialization of event subscription to avoid import-time Instance access
let subscribed = false
function ensureSubscribed() {
  if (subscribed) return
  subscribed = true

  // Listen for session idle events to schedule cleanup
  Bus.subscribe(SessionStatus.Event.Idle, (evt) => {
    const shell = shells.get(evt.properties.sessionID)
    if (shell) {
      shell.resetIdleTimer(() => {
        dispose(evt.properties.sessionID)
      })
    }
  })
}
