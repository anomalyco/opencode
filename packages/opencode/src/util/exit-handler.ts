/**
 * Centralized process exit management for graceful shutdown.
 * 
 * This handler manages the process lifecycle, coordinating:
 * - Resource cleanup (via registered handlers)
 * - Subprocess termination (when needed)
 * - Test mode support (disables subprocess kill for testing)
 * - Consistent exit codes
 * 
 * In production, subprocesses are explicitly killed to prevent hanging
 * (especially important for Docker-based MCP servers that don't handle SIGTERM).
 * In test mode, subprocess killing is disabled to allow clean exit.
 */

import { ChildProcess } from "child_process"

type ExitHandler = (code: number) => Promise<void> | void

interface ExitHandlerConfig {
  /** Handlers to run on exit (cleanup, resource release, etc.) */
  handlers?: ExitHandler[]
  /** Whether to kill subprocess pool on exit (false in test mode) */
  killSubprocesses?: boolean
  /** Optional callback when exit is triggered */
  onExit?: (code: number) => Promise<void> | void
}

class ExitManager {
  private handlers: ExitHandler[] = []
  private config: Required<ExitHandlerConfig> = {
    handlers: [],
    killSubprocesses: !this.isTestMode(),
    onExit: undefined as unknown as (code: number) => Promise<void> | void,
  }
  private subprocesses = new Set<ChildProcess>()
  private isShuttingDown = false

  private isTestMode(): boolean {
    return process.env.OPENCODE_TEST_MODE === "1"
  }

  /**
   * Configure the exit handler behavior.
   * Call this early in your application setup.
   */
  configure(config: ExitHandlerConfig): void {
    this.config.handlers = config.handlers ?? []
    this.config.killSubprocesses = config.killSubprocesses ?? !this.isTestMode()
    this.config.onExit = config.onExit ?? (undefined as unknown as (code: number) => Promise<void> | void)
  }

  /**
   * Register a handler to run on process exit.
   * Handlers run in LIFO order (last registered = first executed).
   */
  registerHandler(handler: ExitHandler): void {
    this.handlers.unshift(handler)
  }

  /**
   * Register a subprocess for tracking/cleanup.
   * If killSubprocesses is enabled, it will be terminated on exit.
   */
  trackSubprocess(proc: ChildProcess): void {
    this.subprocesses.add(proc)
    proc.once("exit", () => this.subprocesses.delete(proc))
  }

  /**
   * Gracefully shutdown the process.
   * Runs registered handlers, kills subprocesses (if configured), then exits.
   */
  async shutdown(code: number = 0): Promise<void> {
    if (this.isShuttingDown) return
    this.isShuttingDown = true

    try {
      // Run registered cleanup handlers
      for (const handler of this.handlers) {
        try {
          await Promise.resolve(handler(code))
        } catch (err) {
          console.error("Error in exit handler:", err)
        }
      }

      // Run optional exit callback
      if (this.config.onExit) {
        try {
          await Promise.resolve(this.config.onExit(code))
        } catch (err) {
          console.error("Error in onExit callback:", err)
        }
      }
    } finally {
      // Kill tracked subprocesses if configured
      if (this.config.killSubprocesses) {
        for (const proc of this.subprocesses) {
          if (!proc.killed) {
            try {
              proc.kill("SIGTERM")
              // Give subprocess time to respond to SIGTERM
              await new Promise((resolve) => setTimeout(resolve, 100))
              if (!proc.killed) {
                proc.kill("SIGKILL")
              }
            } catch {
              // Already dead or permission error
            }
          }
        }
      }

      // Exit the process
      process.exitCode = code
      if (code !== 0 || !this.isTestMode()) {
        process.exit(code)
      }
    }
  }

  /**
   * Set the exit code without immediately exiting.
   * Useful when you want the process to exit naturally.
   */
  setExitCode(code: number): void {
    process.exitCode = code
  }

  /**
   * Helper to create an error that will trigger graceful shutdown.
   * Throw this when you want to exit with an error code.
   */
  createExitError(message: string, code: number = 1): Error {
    const err = new Error(message)
    Object.defineProperty(err, "exitCode", { value: code })
    return err
  }
}

// Export singleton instance
export const ExitHandler = new ExitManager()
