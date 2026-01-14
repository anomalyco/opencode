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

  /**
   * Detects if a command is a PowerShell command
   */
  export function isPowerShellCommand(command: string): boolean {
    const trimmed = command.trim()
    return /^(?:powershell|pwsh)(\.exe)?\s/i.test(trimmed)
  }

  /**
   * Detects if PowerShell arguments contain debug or verbose flags
   * @param argsString - The PowerShell arguments string to analyze
   * @returns Object with hasDebug and hasVerbose boolean properties
   */
   function detectDebugAndVerboseFlags(argsString: string): { hasDebug: boolean, hasVerbose: boolean } {
     // Check for -Debug and -Verbose flags in the arguments string
     const debugMatch = argsString.match(/(^|\s)-Debug(\s|$)/i)
     const verboseMatch = argsString.match(/(^|\s)-Verbose(\s|$)/i)
     return {
       hasDebug: !!debugMatch,
       hasVerbose: !!verboseMatch
     }
   }

  /**
   * Detects if a command is a CMD command
   */
  export function isCmdCommand(command: string): boolean {
    const trimmed = command.trim()
    return /^cmd(\.exe)?\s/i.test(trimmed)
  }

  /**
   * Detects if a CMD command string contains dynamic environment variables
   * that might change during command execution (e.g., %cd%, %temp%, %random%)
   */
  export function hasDynamicEnvVars(command: string): boolean {
    return /%(cd|temp|tmp|random|time|date)%/i.test(command)
  }

  /**
   * Converts CMD immediate expansion syntax (%var%) to delayed expansion syntax (!var!)
   * for dynamic environment variables
   */
  function convertToDelayedExpansion(command: string): string {
    return command.replace(/%(cd|temp|tmp|random|time|date)%/gi, (match) => {
      const varName = match.slice(1, -1)
      return `!${varName}!`
    })
  }

  /**
   * Configuration for spawning a command
   */
  export interface SpawnConfig {
    /** The executable to spawn (e.g., "powershell.exe", "cmd.exe", or the original command) */
    executable: string
    /** Arguments to pass to the executable (empty array if using shell flag) */
    args: string[]
    /** Whether to use the shell option in spawn */
    useShellFlag: boolean
    /** The shell to use if useShellFlag is true */
    shell?: string
  }

  /**
   * Determines the correct spawn configuration for a command on Windows.
   * Routes PowerShell and CMD commands directly to their executables to avoid
   * variable corruption when passing through Git Bash.
   */
  export function getSpawnConfig(command: string): SpawnConfig {
    // Only apply special handling on Windows
    if (process.platform !== "win32") {
      return {
        executable: command,
        args: [],
        useShellFlag: true,
        shell: acceptable(),
      }
    }

    // Check for PowerShell commands
    if (isPowerShellCommand(command)) {
      // Extract the powershell executable and arguments
      // Match pattern: powershell[.exe] or pwsh[.exe] <args>
      const match = command.match(/^(powershell|pwsh)(?:\.exe)?\s+(.*)$/i)
      if (match) {
        const [, , argsString] = match
        
        // Check for debug/verbose flags in the arguments
        const { hasDebug, hasVerbose } = detectDebugAndVerboseFlags(argsString)
        
        // Parse PowerShell arguments - split on -Command, -File, etc. but keep quoted strings intact
        // For -Command, we want: ["-Command", "the command string"]
        // For -NoProfile -Command, we want: ["-NoProfile", "-Command", "the command string"]
        const args: string[] = []
        let current = argsString.trim()

        while (current.length > 0) {
          // Check for -Command or -c flag - everything after is a single argument
          const commandFlagMatch = current.match(/^(-Command|-c)(?:\s+|$)/i)
          if (commandFlagMatch) {
            args.push(commandFlagMatch[1])
            current = current.slice(commandFlagMatch[0].length).trim()
            // Everything remaining is the command argument
            if (current.length > 0) {
              // Remove surrounding quotes if present
              let commandArg = current;
              if ((commandArg.startsWith('"') && commandArg.endsWith('"')) ||
                  (commandArg.startsWith("'") && commandArg.endsWith("'"))) {
                commandArg = commandArg.slice(1, -1);
              }
              
              // Prepend appropriate preference variables if debug/verbose flags were detected
              const preferenceStatements = []
              if (hasDebug) {
                preferenceStatements.push(`$DebugPreference='Continue'`)
              }
              if (hasVerbose) {
                preferenceStatements.push(`$VerbosePreference='Continue'`)
              }
              if (preferenceStatements.length > 0) {
                commandArg = `${preferenceStatements.join('; ')}; ${commandArg}`
              }
              
              args.push(commandArg)
            }
            break
          }

          // Match other flags (starts with -)
          const flagMatch = current.match(/^(-\w+)(?:\s+|$)/)
          if (flagMatch) {
            // Preserve all flags including -Debug and -Verbose since we handle them via preference variables
            const flag = flagMatch[1]
            args.push(flag)
            current = current.slice(flagMatch[0].length).trim()
            continue
          }

          // Match quoted string (double quotes)
          const quotedMatch = current.match(/^"((?:[^"\\]|\\.)*)"/s)
          if (quotedMatch) {
            args.push(quotedMatch[1])
            current = current.slice(quotedMatch[0].length).trim()
            continue
          }

          // Match single quoted string
          const singleQuotedMatch = current.match(/^'((?:[^'\\]|\\.)*)'/s)
          if (singleQuotedMatch) {
            args.push(singleQuotedMatch[1])
            current = current.slice(singleQuotedMatch[0].length).trim()
            continue
          }

          // Match unquoted word
          const wordMatch = current.match(/^(\S+)/)
          if (wordMatch) {
            args.push(wordMatch[1])
            current = current.slice(wordMatch[0].length).trim()
            continue
          }

          // Should not reach here, but break to prevent infinite loop
          break
        }
        
        return {
          executable: match[1].toLowerCase() === "pwsh" ? "pwsh.exe" : "powershell.exe",
          args,
          useShellFlag: false,
        }
      }
    }

    // Check for CMD commands
    if (isCmdCommand(command)) {
      // Extract the cmd executable and arguments
      // Match pattern: cmd[.exe] <args>
      const match = command.match(/^(cmd(?:\.exe)?)\s+(.*)$/i)
      if (match) {
        const [, , argsString] = match
        // For CMD, we want to split on /c or /k but keep the rest as a single argument
        // e.g., "cmd /c echo hello" -> ["/c", "echo hello"]
        const cmdArgs: string[] = []
        const cmdMatch = argsString.match(/^(\/[ck])\s+(.*)$/i)
        let commandToExecute = argsString

        if (cmdMatch) {
          cmdArgs.push(cmdMatch[1])
          commandToExecute = cmdMatch[2]
        }

        // Fix for chained commands (&& or ||) with dynamic environment variables (e.g., %cd%)
        // CMD expands %variables% at parse time, not execution time, which breaks `cd /d %temp% && echo %cd%`
        // We enable delayed expansion (/V:ON) and convert %var% to !var! for dynamic variables.
        const isChained = /(&&|\|\|)/.test(commandToExecute)
        const hasDynamicVars = hasDynamicEnvVars(commandToExecute)
        const hasVOn = argsString.match(/\/V:ON/i)

        if (isChained && hasDynamicVars && !hasVOn) {
          // Add /V:ON flag for delayed expansion
          cmdArgs.unshift("/V:ON")
          // Convert dynamic variables to delayed expansion syntax
          commandToExecute = convertToDelayedExpansion(commandToExecute)
        }

        cmdArgs.push(commandToExecute)

        return {
          executable: process.env.COMSPEC || "cmd.exe",
          args: cmdArgs,
          useShellFlag: false,
        }
      }
    }

    // For all other commands (git, npm, etc.), use the shell
    return {
      executable: command,
      args: [],
      useShellFlag: true,
      shell: acceptable(),
    }
  }
}