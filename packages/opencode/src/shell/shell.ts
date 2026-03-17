import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { setTimeout as sleep } from "node:timers/promises"

const SIGKILL_TIMEOUT_MS = 200

/**
 * Shell utilities for process management and shell detection.
 *
 * Provides functionality for terminating process trees and detecting
 * the appropriate shell for the current platform.
 *
 * @example
 * ```typescript
 * await Shell.killTree(childProcess)
 * const shell = Shell.preferred()
 * const acceptable = Shell.acceptable()
 * ```
 */
export namespace Shell {
  /**
   * Kills a process and its entire process tree.
   *
   * On Windows, uses taskkill with /f /t flags. On Unix-like systems,
   * sends SIGTERM first, then SIGKILL after a timeout if needed.
   *
   * @param proc - The child process to kill
   * @param opts - Optional configuration
   * @param opts.exited - Function to check if process has already exited
   * @returns Promise that resolves when the process tree is terminated
   */
  export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
    const pid = proc.pid
    if (!pid || opts?.exited?.()) return

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        })
        killer.once("exit", () => resolve())
        killer.once("error", () => resolve())
      })
      return
    }

    try {
      process.kill(-pid, "SIGTERM")
      await sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        process.kill(-pid, "SIGKILL")
      }
    } catch (_e) {
      proc.kill("SIGTERM")
      await sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    }
  }
  const BLACKLIST = new Set(["fish", "nu"])

  function fallback() {
    if (process.platform === "win32") {
      if (Flag.OPENCODE_GIT_BASH_PATH) return Flag.OPENCODE_GIT_BASH_PATH
      const git = which("git")
      if (git) {
        // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
        // bash.exe is at: C:\Program Files\Git\bin\bash.exe
        const bash = path.join(git, "..", "..", "bin", "bash.exe")
        if (Filesystem.stat(bash)?.size) return bash
      }
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") return "/bin/zsh"
    const bash = which("bash")
    if (bash) return bash
    return "/bin/sh"
  }

  /**
   * Returns the preferred shell for the current platform.
   *
   * Uses the SHELL environment variable if available, otherwise
   * falls back to platform-specific defaults (zsh on macOS, bash on Linux, etc.).
   *
   * @returns Lazy-evaluated preferred shell path
   */
  export const preferred = lazy(() => {
    const s = process.env.SHELL
    if (s) return s
    return fallback()
  })

  /**
   * Returns an acceptable shell for the current platform, avoiding blacklisted shells.
   *
   * Falls back to platform defaults if the user's SHELL is blacklisted
   * (e.g., fish, nu shells that may have compatibility issues).
   *
   * @returns Lazy-evaluated acceptable shell path
   */
  export const acceptable = lazy(() => {
    const s = process.env.SHELL
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return fallback()
  })
}
