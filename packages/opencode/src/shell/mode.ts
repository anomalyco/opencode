import { Log } from "../util/log"
import { which } from "bun"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "shell-mode" })

/**
 * Execution modes for OpenCode
 */
export enum ExecutionMode {
  Shell = "Shell",   // Direct shell execution
  Agent = "Agent",   // AI agent processing
  Auto = "Auto"      // Intelligent routing
}

/**
 * ModeController manages the current execution mode and provides routing logic
 */
export class ModeController {
  private currentMode: ExecutionMode
  private persistedMode: ExecutionMode | null = null
  
  // Shell builtins that should always route to shell
  private static readonly SHELL_BUILTINS = new Set([
    "alias", "bg", "bind", "break", "builtin", "case", "cd", "command",
    "compgen", "complete", "continue", "declare", "dirs", "disown", "echo",
    "enable", "eval", "exec", "exit", "export", "false", "fc", "fg",
    "getopts", "hash", "help", "history", "if", "jobs", "kill", "let",
    "local", "logout", "popd", "printf", "pushd", "pwd", "read", "readonly",
    "return", "set", "shift", "shopt", "source", "suspend", "test", "times",
    "trap", "true", "type", "typeset", "ulimit", "umask", "unalias", "unset",
    "wait", "while"
  ])
  
  // Common shell operators and redirections
  private static readonly SHELL_OPERATORS = [
    "&&", "||", "|", ";", "&", ">", ">>", "<", "<<", "2>", "2>&1"
  ]
  
  constructor(defaultMode: ExecutionMode = ExecutionMode.Auto) {
    this.currentMode = defaultMode
    log.info("initialized", { mode: this.currentMode })
  }
  
  /**
   * Get the current execution mode
   */
  getMode(): ExecutionMode {
    return this.currentMode
  }
  
  /**
   * Set the execution mode
   */
  setMode(mode: ExecutionMode): void {
    const prev = this.currentMode
    this.currentMode = mode
    log.info("mode changed", { from: prev, to: mode })
  }
  
  /**
   * Toggle between modes in order: Shell -> Agent -> Auto -> Shell
   */
  toggleMode(): ExecutionMode {
    const modes = [ExecutionMode.Shell, ExecutionMode.Agent, ExecutionMode.Auto]
    const currentIndex = modes.indexOf(this.currentMode)
    const nextIndex = (currentIndex + 1) % modes.length
    this.setMode(modes[nextIndex])
    return this.currentMode
  }
  
  /**
   * Persist current mode to configuration
   */
  async persistMode(): Promise<void> {
    this.persistedMode = this.currentMode
    // This would integrate with Config system to save to opencode.json
    log.debug("mode persisted", { mode: this.currentMode })
  }
  
  /**
   * Restore persisted mode if available
   */
  restoreMode(): void {
    if (this.persistedMode !== null) {
      this.currentMode = this.persistedMode
      log.debug("mode restored", { mode: this.currentMode })
    }
  }
  
  /**
   * Determine if input should be routed to shell in Auto mode
   */
  async shouldRouteToShell(input: string): Promise<boolean> {
    // If not in Auto mode, respect the current mode
    if (this.currentMode === ExecutionMode.Shell) return true
    if (this.currentMode === ExecutionMode.Agent) return false
    
    // Auto mode routing logic
    const trimmed = input.trim()
    if (!trimmed) return false
    
    // Extract the first token (command)
    const tokens = this.tokenize(trimmed)
    if (tokens.length === 0) return false
    
    const firstToken = tokens[0]
    
    // Check for shell operators
    if (this.containsShellOperators(trimmed)) {
      log.debug("routing to shell: contains operators", { input: trimmed })
      return true
    }
    
    // Check for shell builtins
    if (ModeController.SHELL_BUILTINS.has(firstToken)) {
      log.debug("routing to shell: builtin command", { command: firstToken })
      return true
    }
    
    // Check for environment variable assignments
    if (this.isEnvAssignment(firstToken)) {
      log.debug("routing to shell: environment assignment", { input: firstToken })
      return true
    }
    
    // Check if it's a path to an executable
    if (await this.isExecutablePath(firstToken)) {
      log.debug("routing to shell: executable path", { path: firstToken })
      return true
    }
    
    // Check if command exists in PATH
    if (await this.isInPath(firstToken)) {
      log.debug("routing to shell: command in PATH", { command: firstToken })
      return true
    }
    
    // Default to agent for natural language or unknown commands
    log.debug("routing to agent: no shell match", { input: trimmed })
    return false
  }
  
  /**
   * Tokenize input string into command tokens
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = []
    let current = ""
    let inSingleQuote = false
    let inDoubleQuote = false
    let escaped = false
    
    for (let i = 0; i < input.length; i++) {
      const char = input[i]
      
      if (escaped) {
        current += char
        escaped = false
        continue
      }
      
      if (char === "\\") {
        escaped = true
        continue
      }
      
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        continue
      }
      
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        continue
      }
      
      if (char === " " && !inSingleQuote && !inDoubleQuote) {
        if (current) {
          tokens.push(current)
          current = ""
        }
        continue
      }
      
      current += char
    }
    
    if (current) {
      tokens.push(current)
    }
    
    return tokens
  }
  
  /**
   * Check if input contains shell operators
   */
  private containsShellOperators(input: string): boolean {
    return ModeController.SHELL_OPERATORS.some(op => input.includes(op))
  }
  
  /**
   * Check if token is an environment variable assignment
   */
  private isEnvAssignment(token: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
  }
  
  /**
   * Check if path points to an executable file
   */
  private async isExecutablePath(filepath: string): Promise<boolean> {
    if (!filepath.includes("/")) return false
    
    try {
      const resolvedPath = path.resolve(filepath)
      const stats = await fs.stat(resolvedPath)
      
      if (!stats.isFile()) return false
      
      // Check if file is executable (Unix-like systems)
      if (process.platform !== "win32") {
        const mode = stats.mode
        const isOwnerExecutable = (mode & 0o100) !== 0
        const isGroupExecutable = (mode & 0o010) !== 0
        const isOtherExecutable = (mode & 0o001) !== 0
        return isOwnerExecutable || isGroupExecutable || isOtherExecutable
      }
      
      // On Windows, check file extension
      const ext = path.extname(filepath).toLowerCase()
      return [".exe", ".bat", ".cmd", ".ps1"].includes(ext)
    } catch {
      return false
    }
  }
  
  /**
   * Check if command exists in PATH
   */
  private async isInPath(command: string): Promise<boolean> {
    try {
      const result = which(command)
      return result !== null
    } catch {
      return false
    }
  }
  
  /**
   * Get mode display information for UI
   */
  getModeDisplay(): { name: string; color: string; icon: string } {
    switch (this.currentMode) {
      case ExecutionMode.Shell:
        return { name: "Shell", color: "blue", icon: "▌" }
      case ExecutionMode.Agent:
        return { name: "Agent", color: "purple", icon: "▌" }
      case ExecutionMode.Auto:
        return { name: "Auto", color: "green", icon: "▌" }
    }
  }
}

// Singleton instance
let instance: ModeController | null = null

export function getModeController(): ModeController {
  if (!instance) {
    instance = new ModeController()
  }
  return instance
}