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
      // On Windows, default to cmd.exe/PowerShell to avoid Git bash.exe crashes
      // This prevents ACCESS_VIOLATION (0xC0000005) crashes with OpenCode's PTY
      if (Flag.OPENCODE_GIT_BASH_PATH) return Flag.OPENCODE_GIT_BASH_PATH
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

  /**
   * Returns the appropriate shell for executing the given command.
   * - Unix commands (sh, bash, awk, sed, grep, etc.) on Windows → Git bash
   * - All other commands → Platform default shell
   */
  export function forCommand(command: string): string {
    if (needsUnixShell(command)) {
      // Unix commands need a Unix shell - use Git bash on Windows
      const gitBashPath = getGitBashPath()
      if (gitBashPath) return gitBashPath
    }
    return fallback()
  }

  /**
   * Checks if the command is likely a Unix command that requires a Unix shell.
   */
  function needsUnixShell(command: string): boolean {
    // Common Unix commands that need Unix shell features
    const unixCommands = new Set([
      "sh", "bash", "dash", "zsh", "fish",
      "awk", "sed", "grep", "egrep", "fgrep",
      "ls", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat", "echo",
      "head", "tail", "cut", "sort", "uniq", "wc", "tr", "find", "xargs",
      "tar", "gzip", "bzip2", "xz", "zip", "unzip",
      "ssh", "scp", "rsync", "curl", "wget",
      "make", "cmake", "npm", "yarn", "pnpm", "bun",
      "git", "svn", "hg",
      "ps", "kill", "killall", "jobs", "fg", "bg",
      "alias", "export", "source", "eval", "test", "[", "[[",
      "cd", "pwd", "export", "unset", "set", "env", "export",
    ])
    
    // Simple heuristic: check if command starts with a known Unix command
    const firstWord = command.trim().split(/\s+/)[0].toLowerCase()
    return unixCommands.has(firstWord) || 
           // Also check for pipes, redirects, and other shell features
           command.includes("|") || 
           command.includes(">") || 
           command.includes("<") ||
           command.includes("&&") ||
           command.includes("||") ||
           command.includes("$((")
  }

  /**
   * Gets the Git bash executable path on Windows.
   * Returns undefined if not found.
   */
  function getGitBashPath(): string | undefined {
    if (process.platform !== "win32") return undefined
    
    // Check OPENCODE_GIT_BASH_PATH flag first
    if (Flag.OPENCODE_GIT_BASH_PATH) return Flag.OPENCODE_GIT_BASH_PATH
    
    // Try to find git bash
    const git = Bun.which("git")
    if (git) {
      // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
      // bash.exe is at: C:\Program Files\Git\bin\bash.exe
      const bash = path.join(git, "..", "..", "bin", "bash.exe")
      if (Bun.file(bash).size) return bash
    }
    
    return undefined
  }

  /**
   * Gets all available shells for the current platform.
   */
  export function getAvailableShells(): string[] {
    const shells: string[] = []
    
    if (process.platform === "win32") {
      // Windows shells
      const gitBash = getGitBashPath()
      if (gitBash) shells.push(gitBash)
      shells.push(process.env.COMSPEC || "cmd.exe")
      shells.push(process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe")
    } else {
      // Unix shells
      shells.push("/bin/bash")
      shells.push("/bin/zsh")
      shells.push("/bin/sh")
    }
    
    return shells
  }
}
