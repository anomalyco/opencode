import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { Config } from "@/config/config"

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

  // Commands that require a Unix-like shell (Git bash on Windows)
  const UNIX_COMMANDS = new Set([
    "ls", "cat", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "grep", "sed", "awk",
    "find", "sort", "uniq", "wc", "head", "tail", "tr", "cut", "paste", "join", "diff",
    "bun", "npm", "pnpm", "yarn", "git", "ssh", "scp", "rsync", "curl", "wget", "tar",
    "gzip", "bzip2", "xz", "zip", "unzip", "echo", "printf", "test", "[", "((", "[[",
    "while", "for", "if", "case", "function", "source", "alias", "export", "unset",
    "env", "printenv", "dirname", "basename", "realpath", "readlink", "ln", "symlink",
  ])

  function needsUnixShell(command: string): boolean {
    // Check if the command is a known Unix command
    const cmd = command.toLowerCase().trim()
    if (UNIX_COMMANDS.has(cmd)) return true
    // Check for common Unix command patterns
    if (cmd.includes("|") || cmd.includes(">") || cmd.includes("<") || cmd.includes("&&") || cmd.includes("||")) {
      return true
    }
    // Check for Unix-specific flags
    if (cmd.includes(" -l") || cmd.includes(" --list") || cmd.includes(" -r") || cmd.includes("-r ")) {
      return true
    }
    return false
  }

  function getGitBashPath(): string | undefined {
    const git = Bun.which("git")
    if (git) {
      const bash = path.join(git, "..", "..", "bin", "bash.exe")
      if (Bun.file(bash).size) return bash
    }
    return undefined
  }

  function fallback() {
    if (process.platform === "win32") {
      // Prefer Windows native shells over Git bash to avoid compatibility issues
      // Git's bash.exe can cause ACCESS_VIOLATION errors with OpenCode's PTY implementation
      if (Flag.OPENCODE_TERMINAL) return Flag.OPENCODE_TERMINAL
      // Check for PowerShell first (more feature-rich)
      const powershell = Bun.which("powershell.exe")
      if (powershell) return powershell
      // Fall back to cmd.exe
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") return "/bin/zsh"
    const bash = Bun.which("bash")
    if (bash) return bash
    return "/bin/sh"
  }

  export const preferred = lazy(async () => {
    // Check config first for user preference
    const config = await Config.get()
    if (config.terminal) return config.terminal
    // Fall back to environment variable
    const s = process.env.SHELL
    if (s) return s
    return fallback()
  })

  export const acceptable = lazy(() => {
    const s = process.env.SHELL
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return fallback()
  })

  export function forCommand(command: string): string {
    // For Windows, check if the command needs a Unix shell
    if (process.platform === "win32") {
      // Check for explicit user preference first
      if (Flag.OPENCODE_TERMINAL) return Flag.OPENCODE_TERMINAL
      // Check if command needs Unix shell
      if (needsUnixShell(command)) {
        const gitBash = getGitBashPath()
        if (gitBash) return gitBash
      }
      // Check for PowerShell commands
      if (command.toLowerCase().startsWith("powershell") || command.toLowerCase().startsWith("pwsh")) {
        const powershell = Bun.which("powershell.exe") || Bun.which("pwsh.exe")
        if (powershell) return powershell
      }
      // Default to native shell for Windows commands
      return process.env.COMSPEC || "cmd.exe"
    }
    // On Unix/macOS, use the default shell
    const s = process.env.SHELL
    if (s) return s
    if (process.platform === "darwin") return "/bin/zsh"
    return Bun.which("bash") || "/bin/sh"
  }

  export function getAvailableShells(): { name: string; path: string; description: string }[] {
    const shells: { name: string; path: string; description: string }[] = []

    if (process.platform === "win32") {
      // Git Bash
      const gitBash = getGitBashPath()
      if (gitBash) {
        shells.push({
          name: "Git Bash",
          path: gitBash,
          description: "Unix-like shell with Git. Supports ls, cat, bun, etc. May have compatibility issues with PTY.",
        })
      }

      // PowerShell
      const powershell = Bun.which("powershell.exe")
      if (powershell) {
        shells.push({
          name: "PowerShell",
          path: powershell,
          description: "Modern Windows shell with advanced scripting capabilities. Recommended for stability.",
        })
      }

      // Windows Terminal with PowerShell/CMD
      shells.push({
        name: "Windows Terminal (PowerShell)",
        path: "powershell.exe",
        description: "PowerShell running in Windows Terminal. Better experience than standalone PowerShell.",
      })

      shells.push({
        name: "Command Prompt (CMD)",
        path: process.env.COMSPEC || "cmd.exe",
        description: "Traditional Windows command prompt. Compatible but limited features.",
      })
    } else {
      shells.push({
        name: "Zsh",
        path: "/bin/zsh",
        description: "Default shell on macOS. Powerful and feature-rich.",
      })

      const bashPath = Bun.which("bash")
      if (bashPath) {
        shells.push({
          name: "Bash",
          path: bashPath,
          description: "GNU Bourne Again Shell. Widely used on Linux and macOS.",
        })
      }
    }

    return shells
  }
}
