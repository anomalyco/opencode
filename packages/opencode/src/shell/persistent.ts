import { exec } from "child_process"
import { promisify } from "util"
import path from "path"
import { Log } from "../util/log"
import { App } from "../app/app"

const execAsync = promisify(exec)
const log = Log.create({ service: "persistent-shell" })

export interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number | null
  success: boolean
}

export interface ShellEnvironment {
  [key: string]: string
}

/**
 * PersistentShell maintains shell state across command executions
 * including working directory and environment variables
 */
export class PersistentShell {
  private workingDir: string
  private environment: Map<string, string>
  private shellBinary: string
  
  constructor() {
    const app = App.info()
    this.workingDir = app.path.cwd
    this.environment = new Map(Object.entries(process.env as ShellEnvironment))
    
    // Detect user's shell
    this.shellBinary = process.env['SHELL'] || "/bin/sh"
    
    log.info("initialized", {
      workingDir: this.workingDir,
      shell: this.shellBinary,
      envCount: this.environment.size
    })
  }
  
  /**
   * Execute a command in the persistent shell context
   */
  async execute(command: string, options?: {
    timeout?: number
    signal?: AbortSignal
  }): Promise<ShellResult> {
    // Handle cd commands specially to update working directory
    if (command.trim().startsWith("cd ")) {
      return this.handleCdCommand(command)
    }
    
    // Handle export commands to update environment
    if (command.trim().startsWith("export ")) {
      return this.handleExportCommand(command)
    }
    
    // Execute command with current state
    const env = Object.fromEntries(this.environment)
    
    try {
      const result = await execAsync(command, {
        cwd: this.workingDir,
        env,
        timeout: options?.timeout,
        signal: options?.signal,
        shell: this.shellBinary
      })
      
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
        success: true
      }
    } catch (error: any) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        success: false
      }
    }
  }
  
  /**
   * Handle cd command to update working directory
   */
  private async handleCdCommand(command: string): Promise<ShellResult> {
    const match = command.match(/^cd\s+(.+)/)
    if (!match) {
      // cd with no args goes to home
      this.workingDir = process.env['HOME'] || "/"
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        success: true
      }
    }
    
    let targetDir = match[1].trim()
    
    // Remove quotes if present
    if ((targetDir.startsWith('"') && targetDir.endsWith('"')) ||
        (targetDir.startsWith("'") && targetDir.endsWith("'"))) {
      targetDir = targetDir.slice(1, -1)
    }
    
    // Handle ~ expansion
    if (targetDir.startsWith("~")) {
      targetDir = targetDir.replace(/^~/, process.env['HOME'] || "/")
    }
    
    // Resolve relative paths
    const resolvedPath = path.resolve(this.workingDir, targetDir)
    
    // Verify directory exists
    const fs = await import("fs/promises")
    try {
      const stats = await fs.stat(resolvedPath)
      if (!stats.isDirectory()) {
        return {
          stdout: "",
          stderr: `cd: not a directory: ${targetDir}`,
          exitCode: 1,
          success: false
        }
      }
      
      this.workingDir = resolvedPath
      log.debug("changed directory", { from: this.workingDir, to: resolvedPath })
      
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        success: true
      }
    } catch (error) {
      return {
        stdout: "",
        stderr: `cd: no such file or directory: ${targetDir}`,
        exitCode: 1,
        success: false
      }
    }
  }
  
  /**
   * Handle export command to update environment variables
   */
  private handleExportCommand(command: string): ShellResult {
    const match = command.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)/)
    if (!match) {
      return {
        stdout: "",
        stderr: "export: invalid syntax",
        exitCode: 1,
        success: false
      }
    }
    
    const [, name, value] = match
    let cleanValue = value.trim()
    
    // Remove quotes if present
    if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
        (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
      cleanValue = cleanValue.slice(1, -1)
    }
    
    this.environment.set(name, cleanValue)
    log.debug("set environment variable", { name, value: cleanValue })
    
    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      success: true
    }
  }
  
  /**
   * Get current working directory
   */
  getWorkingDir(): string {
    return this.workingDir
  }
  
  /**
   * Set working directory
   */
  setWorkingDir(dir: string): void {
    this.workingDir = dir
  }
  
  /**
   * Get environment variable
   */
  getEnv(key: string): string | undefined {
    return this.environment.get(key)
  }
  
  /**
   * Set environment variable
   */
  setEnv(key: string, value: string): void {
    this.environment.set(key, value)
  }
  
  /**
   * Get all environment variables
   */
  getEnvironment(): ShellEnvironment {
    return Object.fromEntries(this.environment)
  }
  
  /**
   * Reset shell state to defaults
   */
  reset(): void {
    const app = App.info()
    this.workingDir = app.path.cwd
    this.environment = new Map(Object.entries(process.env as ShellEnvironment))
    log.info("reset shell state")
  }
}

// Singleton instance
let instance: PersistentShell | null = null

export function getPersistentShell(): PersistentShell {
  if (!instance) {
    instance = new PersistentShell()
  }
  return instance
}