/**
 * SSH Invocation Builder
 *
 * Constructs SSH command arguments with explicit security model:
 * - Array-based construction prevents command injection
 * - Explicit config mode control (pass-through vs isolation)
 * - Mandatory security flags enforced
 * - Platform-aware handling (Windows -F NUL vs Unix -F /dev/null)
 *
 * Tested SSH versions:
 * - OpenSSH 7.4+ (primary target)
 * - macOS bundled SSH
 * - Debian/Ubuntu ssh-client
 * - Windows OpenSSH port
 */

import { SshConfigMode, SshInvocationParams, SshCommandResult } from "./types"

// Mandatory flags for tunnel operations (passed without -o)
const SSH_TUNNEL_FLAGS = ["-N", "-T"]

// Mandatory options for all SSH operations (passed with -o)
const SSH_MANDATORY_OPTIONS = {
  BatchMode: "yes", // Non-interactive mode
  StrictHostKeyChecking: "yes", // Verify host keys
  ExitOnForwardFailure: "yes", // Fail if port forwarding fails
}

/**
 * Determines if we're on Windows
 */
function isWindows(): boolean {
  if (typeof process === "undefined") {
    return false
  }
  return (process as { platform?: string }).platform === "win32"
}

/**
 * Gets the dev-null equivalent for the current platform
 */
function getDevNull(): string {
  return isWindows() ? "NUL" : "/dev/null"
}

/**
 * Builds SSH invocation arguments for tunnel or bootstrap operations
 *
 * Security properties:
 * - Arguments built as array, not shell command string
 * - No user input in command execution context
 * - SSH config mode explicitly controlled
 * - Mandatory security flags always present
 *
 * Usage for tunnel:
 * ```typescript
 * const builder = new SshInvocationBuilder()
 * const cmd = builder.buildTunnel({
 *   host: "example.com",
 *   user: "alice",
 *   localPort: 8080,
 *   remotePort: 3000,
 *   sshConfigMode: "isolation"
 * })
 * // cmd.executable = "ssh"
 * // cmd.args = ["-N", "-T", "-o", "BatchMode=yes", ..., "alice@example.com"]
 * ```
 *
 * Usage for bootstrap:
 * ```typescript
 * const builder = new SshInvocationBuilder()
 * const cmd = builder.buildBootstrap({
 *   host: "example.com",
 *   user: "ubuntu",
 *   sshConfigMode: "pass-through"
 * })
 * ```
 */
export class SshInvocationBuilder {
  /**
   * Build SSH command for port forwarding tunnel
   * Local port is bound to 127.0.0.1 only
   */
  buildTunnel(params: SshInvocationParams): SshCommandResult {
    if (!params.localPort || !params.remotePort) {
      throw new Error("localPort and remotePort are required for tunnel")
    }

    const args = this.buildBaseArgs(params, true)

    // Add port forwarding: bind locally, forward to remote
    args.push("-L", `127.0.0.1:${params.localPort}:127.0.0.1:${params.remotePort}`)

    // Add user@host
    args.push(this.buildHostString(params))

    return {
      executable: "ssh",
      args,
    }
  }

  /**
   * Build SSH command for bootstrap (remote command execution)
   * Execute hardcoded "opencode server start --json" command
   */
  buildBootstrap(params: SshInvocationParams): SshCommandResult {
    const args = this.buildBaseArgs(params, false)

    // Add user@host and command
    args.push(this.buildHostString(params))
    args.push("opencode", "server", "start", "--json")

    return {
      executable: "ssh",
      args,
    }
  }

  /**
   * Build base SSH arguments common to all operations
   * This includes:
   * - SSH config mode handling
   * - Mandatory security options
   * - Optional profile parameters (port, identity, proxy)
   *
   * @param params - SSH invocation parameters
   * @param includeTunnelFlags - If true, include -N and -T flags (for tunnel operations)
   */
  private buildBaseArgs(params: SshInvocationParams, includeTunnelFlags: boolean): string[] {
    const args: string[] = []

    // Determine config mode (per-profile override, or global default)
    const configMode = params.sshConfigMode || "pass-through"

    // Apply SSH config mode
    if (configMode === "isolation") {
      args.push("-F", getDevNull())
    }
    // For pass-through, don't add -F; let SSH use default config

    // Add mandatory flags (tunnel operations only)
    if (includeTunnelFlags) {
      args.push(...SSH_TUNNEL_FLAGS)
    }

    // Add mandatory security options
    for (const key of Object.keys(SSH_MANDATORY_OPTIONS) as Array<keyof typeof SSH_MANDATORY_OPTIONS>) {
      const value = SSH_MANDATORY_OPTIONS[key]
      args.push("-o")
      if (typeof value === "boolean" && value === true) {
        args.push(key)
      } else {
        args.push(`${key}=${value}`)
      }
    }

    // Add optional profile parameters
    if (params.port !== undefined && params.port !== 22) {
      args.push("-p", String(params.port))
    }

    if (params.identityFiles && params.identityFiles.length > 0) {
      for (const identityFile of params.identityFiles) {
        args.push("-i", identityFile)
      }
    } else if (params.identityFile) {
      args.push("-i", params.identityFile)
    }

    if (params.forwardAgent) {
      args.push("-A")
    }

    if (params.proxyJump) {
      args.push("-J", params.proxyJump)
    }

    // Add additional options from params.options
    if (params.options) {
      for (const key of Object.keys(params.options)) {
        const value = params.options[key]
        args.push("-o")
        if (value === true) {
          args.push(key)
        } else if (value === false) {
          // Skip false boolean options
          args.pop() // Remove the "-o" we just added
        } else {
          args.push(`${key}=${value}`)
        }
      }
    }

    return args
  }

  /**
   * Build user@host string, handling optional user
   */
  private buildHostString(params: SshInvocationParams): string {
    if (params.user) {
      return `${params.user}@${params.host}`
    }
    return params.host
  }
}

/**
 * Singleton instance for convenience
 */
export const sshBuilder = new SshInvocationBuilder()
