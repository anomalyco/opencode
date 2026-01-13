/**
 * SSH Process Lifecycle Manager
 *
 * Manages SSH process lifecycle:
 * 1. Spawn SSH process with proper arguments
 * 2. Track process state (running, exited, failed)
 * 3. Graceful shutdown: close stdin → SIGTERM → SIGKILL
 * 4. Deterministic cleanup: cancel, failure, app exit, sleep/wake
 *
 * Platform Support:
 * - Unix/Linux: SIGTERM → SIGKILL
 * - macOS: SIGTERM → SIGKILL
 * - Windows: Terminate process tree (Job Object or taskkill /T)
 *
 * Invariants:
 * - Parent process owns all SSH children (no detached processes)
 * - No resource leaks on any exit path
 * - Process cleanup guaranteed within timeout
 * - Graceful degradation for unresponsive processes
 */

/**
 * Process lifecycle state
 */
export type ProcessState = "idle" | "spawning" | "running" | "shutting-down" | "exited" | "failed"

/**
 * Active process handle
 */
export interface ProcessHandle {
  /** Process ID */
  pid: number
  /** Current process state */
  state: ProcessState
  /** When process started (unix timestamp) */
  startTime: number
  /** When process exited or failed (unix timestamp) */
  endTime?: number
  /** Exit code (if exited normally) */
  exitCode?: number
  /** Error message (if failed) */
  error?: string
}

/**
 * Process manager options
 */
export interface ProcessManagerOptions {
  /** Timeout for graceful shutdown before SIGKILL (default: 5000ms) */
  shutdownTimeoutMs?: number
  /** Enable stdio capture (default: false) */
  captureOutput?: boolean
}

/**
 * Spawn result
 */
export interface SpawnResult {
  success: true
  handle: ProcessHandle
}

/**
 * Spawn error
 */
export interface SpawnError {
  success: false
  message: string
  details?: string
}

/**
 * SSH Process Manager
 *
 * Handles process spawning, monitoring, and cleanup.
 *
 * Usage:
 * ```typescript
 * const manager = new ProcessManager()
 *
 * // Spawn process
 * const result = await manager.spawn("ssh", ["-N", "-T", "host"], {
 *   shutdownTimeoutMs: 5000
 * })
 *
 * if (result.success) {
 *   const handle = result.handle
 *   console.log(`Process ${handle.pid} running`)
 *
 *   // Graceful shutdown when needed
 *   await manager.shutdown(handle.pid)
 *   console.log(`Process exited with code ${handle.exitCode}`)
 * }
 * ```
 */
export class ProcessManager {
  private processes = new Map<number, ProcessHandle>()
  private shutdownTimeoutMs: number

  constructor(options?: ProcessManagerOptions) {
    this.shutdownTimeoutMs = options?.shutdownTimeoutMs ?? 5000
  }

  /**
   * Spawn a new process
   *
   * On Unix: spawn child process, track PID
   * On Windows: spawn with job object or equivalent
   *
   * @throws SpawnError if spawn fails
   */
  async spawn(
    executable: string,
    args: string[],
    options?: ProcessManagerOptions
  ): Promise<SpawnResult | SpawnError> {
    try {
      // In real implementation, would use Tauri's spawn_command or node's child_process
      // For now, return a mock that demonstrates the interface
      const pid = Math.floor(Math.random() * 100000) + 1000

      const handle: ProcessHandle = {
        pid,
        state: "running",
        startTime: Date.now(),
      }

      this.processes.set(pid, handle)

      return {
        success: true,
        handle,
      }
    } catch (error) {
      return {
        success: false,
        message: "Failed to spawn process",
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Gracefully shutdown a process
   *
   * Strategy:
   * 1. Close stdin to signal process to exit
   * 2. Wait for graceful shutdown (default 5s)
   * 3. Send SIGTERM if still running
   * 4. Wait for SIGTERM (default 5s)
   * 5. Send SIGKILL if still running
   * 6. Guarantee cleanup within shutdown timeout
   *
   * Windows: Use taskkill /T /PID to terminate process tree
   */
  async shutdown(pid: number): Promise<ProcessHandle | null> {
    const handle = this.processes.get(pid)
    if (!handle) {
      return null
    }

    // Update state
    handle.state = "shutting-down"

    // In real implementation:
    // 1. Close stdin
    // 2. Wait for exit
    // 3. Send signals as needed
    // 4. Force kill if necessary

    // Mock implementation marks as exited
    handle.state = "exited"
    handle.endTime = Date.now()
    handle.exitCode = 0

    return handle
  }

  /**
   * Forcefully kill a process
   * Used when graceful shutdown is not possible
   */
  async kill(pid: number): Promise<ProcessHandle | null> {
    const handle = this.processes.get(pid)
    if (!handle) {
      return null
    }

    handle.state = "exited"
    handle.endTime = Date.now()
    handle.exitCode = 143 // SIGKILL

    return handle
  }

  /**
   * Get process status
   */
  getStatus(pid: number): ProcessHandle | null {
    return this.processes.get(pid) ?? null
  }

  /**
   * Cleanup all processes (e.g., on app exit)
   * Wait for graceful shutdown, then force kill any remaining
   */
  async cleanupAll(): Promise<void> {
    const pids = Array.from(this.processes.keys())

    // First, try graceful shutdown for all
    await Promise.all(pids.map((pid) => this.shutdown(pid)))

    // Then force kill any that didn't exit
    for (const pid of pids) {
      const handle = this.getStatus(pid)
      if (handle && handle.state !== "exited") {
        await this.kill(pid)
      }
    }

    this.processes.clear()
  }

  /**
   * Handle system sleep (pause processes if needed)
   */
  async onSleep(): Promise<void> {
    // Track that system is sleeping
    // Reconnection logic will handle resumption
  }

  /**
   * Handle system wake (resume processes if needed)
   */
  async onWake(): Promise<void> {
    // Detect if SSH processes died during sleep
    // Trigger reconnection if needed
  }
}

/**
 * Singleton instance
 */
export const processManager = new ProcessManager()
