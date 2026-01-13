/**
 * SSH Desktop Connectivity - Type Definitions
 * Provides interfaces and types for SSH tunnel management
 */

/**
 * SSH configuration mode strategy
 * - PassThrough: Allow SSH to read default config files; profiles override only specified fields
 * - Isolation: Prevent SSH config file usage by adding `-F /dev/null` (or `-F NUL` on Windows)
 */
export type SshConfigMode = "pass-through" | "isolation"

/**
 * SSH tunnel handle - represents an active SSH tunnel process
 */
export interface SshTunnelHandle {
  /** Process ID of the SSH process */
  pid: number
  /** Allocated local port for tunnel binding */
  localPort: number
  /** Remote port on target host to forward to */
  remotePort: number
}

/**
 * SSH invocation parameters
 */
export interface SshInvocationParams {
  /** Global SSH config mode (can be overridden per-profile) */
  sshConfigMode?: SshConfigMode
  /** Hostname or IP address */
  host: string
  /** Remote user (optional, uses default or SSH config if not specified) */
  user?: string
  /** SSH port (optional, defaults to 22) */
  port?: number
  /** Identity file path (optional) */
  identityFile?: string
  /** Multiple identity files to try (optional, tried in order) */
  identityFiles?: string[]
  /** Enable SSH agent forwarding (optional) */
  forwardAgent?: boolean
  /** ProxyJump target (optional) */
  proxyJump?: string
  /** Local port to bind (only for -L forwarding) */
  localPort?: number
  /** Remote port to forward to */
  remotePort?: number
  /** Additional SSH options as key-value pairs */
  options?: Record<string, string | boolean>
}

/**
 * Result of SSH argument building
 */
export interface SshCommandResult {
  /** Executable name or path */
  executable: string
  /** Array of arguments (safe from injection) */
  args: string[]
}

/**
 * SSH error classification buckets
 */
export type SshErrorBucket =
  | "host-key-failure"
  | "auth-failure"
  | "config-error"
  | "network-failure"
  | "port-forward-failure"
  | "unknown"

export interface SshError {
  bucket: SshErrorBucket
  message: string
  stderr?: string
}
