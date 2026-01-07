import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import path from "path"
import { spawn, type ChildProcess } from "child_process"

const SIGKILL_TIMEOUT_MS = 200

export namespace Shell {
  export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
    const pid = proc.pid
    if (!pid || opts?.exited?.()) return

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })
        killer.once("exit", () => resolve())
        killer.once("error", () => resolve())
      })
      return
    }

    try {
      process.kill(-pid, "SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        process.kill(-pid, "SIGKILL")
      }
    } catch (_e) {
      proc.kill("SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    }
  }
  const BLACKLIST = new Set(["fish", "nu"])

  function fallback() {
    if (process.platform === "win32") {
      if (Flag.OPENCODE_GIT_BASH_PATH) return Flag.OPENCODE_GIT_BASH_PATH
      const git = Bun.which("git")
      if (git) {
        // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
        // bash.exe is at: C:\Program Files\Git\bin\bash.exe
        const bash = path.join(git, "..", "..", "bin", "bash.exe")
        if (Bun.file(bash).size) return bash
      }
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") return "/bin/zsh"
    const bash = Bun.which("bash")
    if (bash) return bash
    return "/bin/sh"
  }

  export const preferred = lazy(() => {
    const s = process.env.SHELL
    if (s) return s
    return fallback()
  })

  export const acceptable = lazy(() => {
    const s = process.env.SHELL
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return fallback()
  })

  function getInvocationArgs(shell: string, command: string): string[] {
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
    ).toLowerCase()

    const invocations: Record<string, string[]> = {
      nu: ["-c", command],
      fish: ["-c", command],
      zsh: [
        "-c",
        "-l",
        `[[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
[[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
eval ${JSON.stringify(command)}`,
      ],
      bash: [
        "-c",
        "-l",
        `shopt -s expand_aliases
[[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
eval ${JSON.stringify(command)}`,
      ],
      cmd: ["/c", command],
      powershell: ["-NoProfile", "-Command", command],
      pwsh: ["-NoProfile", "-Command", command],
    }

    return invocations[shellName] ?? ["-c", command]
  }

  // ============ Unified Execution ============

  export interface ExecuteOptions {
    command: string
    cwd: string
    shell?: string
    loadRcFiles?: boolean
    timeout?: number
    abort: AbortSignal
    env?: Record<string, string>
    onOutput?: (output: string) => void
  }

  export interface ExecuteResult {
    output: string
    exitCode: number | null
    timedOut: boolean
    aborted: boolean
  }

  export async function execute(options: ExecuteOptions): Promise<ExecuteResult> {
    const { command, cwd, shell = acceptable(), loadRcFiles = false, timeout, abort, env = {}, onOutput } = options

    const proc = loadRcFiles
      ? spawn(shell, getInvocationArgs(shell, command), {
          cwd,
          env: { ...process.env, TERM: "dumb", ...env },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        })
      : spawn(command, {
          shell,
          cwd,
          env: { ...process.env, TERM: "dumb", ...env },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        })

    let output = ""
    let timedOut = false
    let aborted = false
    let exited = false

    const append = (chunk: Buffer) => {
      output += chunk.toString()
      onOutput?.(output)
    }

    proc.stdout?.on("data", append)
    proc.stderr?.on("data", append)

    const kill = () => killTree(proc, { exited: () => exited })

    if (abort.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }
    abort.addEventListener("abort", abortHandler, { once: true })

    const timeoutTimer = timeout
      ? setTimeout(() => {
          timedOut = true
          void kill()
        }, timeout + 100)
      : undefined

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        abort.removeEventListener("abort", abortHandler)
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

    return {
      output,
      exitCode: proc.exitCode,
      timedOut,
      aborted,
    }
  }
}
