/**
 * SSH Tunnel Manager
 *
 * Orchestrates SSH tunnel creation:
 * 1. Allocate local port using system socket binding
 * 2. Build SSH command with invocation builder
 * 3. Spawn SSH process
 * 4. Return tunnel handle with process management info
 *
 * Invariants:
 * - One tunnel handle per active tunnel
 * - Tunnel is bound to 127.0.0.1 only
 * - Process PID is tracked for lifecycle management (Task 3)
 * - Port allocation failures are handled gracefully with retries
 */

import { SshInvocationParams, SshTunnelHandle } from "./types"
import { SshInvocationBuilder } from "./invocation-builder"
import { allocatePort, PortAllocatorConfig } from "./port-allocator"

/**
 * Configuration for tunnel creation
 */
export interface TunnelConfig {
  /** SSH invocation parameters */
  sshParams: SshInvocationParams & {
    host: string
    remotePort: number
  }
  /** Port allocator configuration */
  portAllocator?: PortAllocatorConfig
  /** Timeout for SSH command spawn (default: 30s) */
  spawnTimeoutMs?: number
}

/**
 * Tunnel creation result
 */
export interface TunnelCreationResult {
  success: true
  handle: SshTunnelHandle
}

/**
 * Tunnel creation error
 */
export interface TunnelCreationError {
  success: false
  phase: "port-allocation" | "command-build" | "spawn"
  message: string
  details?: string
}

/**
 * SSH Tunnel Manager
 *
 * Manages tunnel lifecycle from creation through process management.
 * Coordinates:
 * - Port allocation (system socket binding with retry)
 * - SSH command building (with config modes, security flags)
 * - Process spawning (delegated to Tauri shell plugin)
 *
 * Usage:
 * ```typescript
 * const manager = new SshTunnelManager()
 * const result = await manager.createTunnel({
 *   sshParams: {
 *     host: "example.com",
 *     user: "alice",
 *     remotePort: 3000,
 *     sshConfigMode: "isolation"
 *   }
 * })
 *
 * if (result.success) {
 *   console.log(`Tunnel on ${result.handle.localPort}`)
 * } else {
 *   console.error(`Failed at ${result.phase}: ${result.message}`)
 * }
 * ```
 */
export class SshTunnelManager {
  private invocationBuilder = new SshInvocationBuilder()

  /**
   * Create a new SSH tunnel
   *
   * Process:
   * 1. Allocate local port with bounded retries
   * 2. Build SSH command with allocated port
   * 3. Spawn SSH process (delegated to caller)
   * 4. Return tunnel handle with process info
   *
   * @throws TunnelCreationError if any phase fails
   */
  async createTunnel(config: TunnelConfig): Promise<TunnelCreationResult | TunnelCreationError> {
    try {
      // Phase 1: Allocate port with retries
      let allocation
      try {
        allocation = await allocatePort(config.portAllocator)
      } catch (error) {
        return {
          success: false,
          phase: "port-allocation",
          message: "Failed to allocate local port",
          details: error instanceof Error ? error.message : String(error),
        }
      }

      // Phase 2: Build SSH command
      let sshCommand
      try {
        const sshParams: SshInvocationParams = {
          ...config.sshParams,
          localPort: allocation.port,
        }
        sshCommand = this.invocationBuilder.buildTunnel(sshParams)
      } catch (error) {
        return {
          success: false,
          phase: "command-build",
          message: "Failed to build SSH command",
          details: error instanceof Error ? error.message : String(error),
        }
      }

      // Phase 3: Return handle with spawn info
      // Note: Actual process spawning is delegated to the caller
      // because Tauri's shell plugin integration happens at that level

      return {
        success: true,
        handle: {
          pid: 0, // Will be set after spawn
          localPort: allocation.port,
          remotePort: config.sshParams.remotePort,
        },
      }
    } catch (error) {
      return {
        success: false,
        phase: "spawn",
        message: "Unexpected error during tunnel creation",
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get SSH command for a tunnel configuration
   * Useful for testing and diagnostics
   */
  getSshCommand(sshParams: SshInvocationParams): string {
    const cmd = this.invocationBuilder.buildTunnel(sshParams)
    return [cmd.executable, ...cmd.args].join(" ")
  }
}

/**
 * Singleton instance for convenience
 */
export const sshTunnelManager = new SshTunnelManager()
