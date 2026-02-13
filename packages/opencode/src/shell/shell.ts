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

  const UNIX_SHELLS = new Set(["bash", "sh", "zsh", "fish", "nu"])

  export function isUnixLike(shell: string): boolean {
    const base = path.basename(shell).toLowerCase().replace(/\.exe$/, "")
    return UNIX_SHELLS.has(base)
  }

  /**
   * On Windows, when using Git Bash the AI model may generate Windows-style
   * `> nul` / `2>nul` redirections.  Git Bash interprets these literally and
   * creates a file called "nul" instead of discarding output.
   *
   * This helper rewrites null-device redirections so they match the shell
   * that will actually execute the command.
   */
  export function sanitizeNullRedirect(command: string, shell: string): string {
    if (process.platform !== "win32") return command
    if (isUnixLike(shell)) {
      // Git Bash / Unix shell: replace Windows NUL with /dev/null
      return command.replace(/(\d?>)\s*(?:nul|NUL)\b/g, "$1/dev/null")
    }
    // cmd.exe / PowerShell: replace /dev/null with NUL
    return command.replace(/(\d?>)\s*\/dev\/null\b/g, "$1NUL")
  }
}
