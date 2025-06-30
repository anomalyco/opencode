import { Installation } from "../installation"

/**
 * CLI Utilities for self-invocation and environment detection
 */
export namespace CLIUtils {
  
  /**
   * Get the command to run the current CLI instance
   * Handles different execution contexts properly
   */
  export function getSelfCommand(): string[] {
    // Development mode: use bun run with source
    if (Installation.isDev() || Installation.VERSION === "dev") {
      return [process.execPath, "run", "./src/index.ts"]
    }
    
    // Production: try to find global installation
    const globalBinary = Bun.which("opencode")
    if (globalBinary) {
      return [globalBinary]
    }
    
    // Fallback to current execution method
    return [process.execPath, "run", "./src/index.ts"]
  }
  
  /**
   * Detect the current execution environment
   */
  export function getExecutionContext(): "development" | "global" | "local" {
    if (Installation.isDev() || Installation.VERSION === "dev") {
      return "development"
    }
    
    if (Bun.which("opencode")) {
      return "global"
    }
    
    return "local"
  }
  
  /**
   * Safely spawn a subprocess with the current CLI
   */
  export async function spawnSelf(
    args: string[],
    options?: {
      cwd?: string
      env?: Record<string, string>
      stdio?: "inherit" | "pipe"
    }
  ): Promise<number> {
    const cmd = [...getSelfCommand(), ...args]
    
    const proc = Bun.spawn({
      cmd,
      cwd: options?.cwd ?? process.cwd(),
      stdout: options?.stdio ?? "inherit",
      stderr: options?.stdio ?? "inherit", 
      stdin: options?.stdio ?? "inherit",
      env: {
        ...process.env,
        ...options?.env,
      },
    })
    
    return await proc.exited
  }
} 