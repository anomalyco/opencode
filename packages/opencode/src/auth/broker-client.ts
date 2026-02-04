import { createConnection, type Socket } from "net"
import { Log } from "@/util/log"

/**
 * Request message sent to the auth broker.
 * Must match Rust protocol.rs format.
 */
interface BrokerRequest {
  /** Unique request ID for multiplexing responses */
  id: string
  /** Protocol version (always 1 for now) */
  version: 1
  /** Method to invoke */
  method:
    | "authenticate"
    | "ping"
    | "registersession"
    | "unregistersession"
    | "spawnpty"
    | "killpty"
    | "resizepty"
    | "ptywrite"
    | "ptyread"
    | "check2fa"
    | "authenticateotp"
    | "checkotpconfig"
    | "setupotp"
    | "removeotp"
  /** Username for authenticate method */
  username?: string
  /** Password for authenticate method */
  password?: string
  /** Session ID for session and PTY methods */
  session_id?: string
  /** UNIX user ID for session registration */
  uid?: number
  /** UNIX group ID for session registration */
  gid?: number
  /** Home directory for session registration */
  home?: string
  /** Login shell for session registration */
  shell?: string
  /** PTY session ID for PTY operations */
  pty_id?: string
  /** Terminal type for PTY spawn */
  term?: string
  /** Column count for PTY spawn/resize */
  cols?: number
  /** Row count for PTY spawn/resize */
  rows?: number
  /** Environment variables for PTY spawn */
  env?: Record<string, string>
  /** Base64-encoded data for ptyWrite */
  data?: string
  /** Maximum bytes to read for ptyRead */
  max_bytes?: number
  /** OTP code for authenticateotp */
  code?: string
  /** Base32 secret for setupotp */
  secret?: string
  /** Confirmation for removeotp */
  confirm?: boolean
}

/**
 * Response message from the auth broker.
 */
interface BrokerResponse {
  /** Request ID this response corresponds to */
  id: string
  /** Whether the operation succeeded */
  success: boolean
  /** Error message if operation failed (generic for auth) */
  error?: string
  /** Optional data payload for responses that return values */
  data?: {
    pty_id?: string
    pid?: number
    /** Base64-encoded data from ptyRead */
    data?: string
    /** Whether more data is available (ptyRead) */
    more?: boolean
    /** OTP config check fields */
    configured?: boolean
    pam_module_installed?: boolean
    pam_module_path?: string
    pam_service_exists?: boolean
    pam_service_path?: string
    service_auto_created?: boolean
    error_code?: string
    /** Setup OTP fields */
    written?: boolean
    already_configured?: boolean
    /** Remove OTP fields */
    removed?: boolean
    already_missing?: boolean
  }
}

/**
 * Result from reading PTY output.
 */
export interface PtyReadResult {
  /** Decoded data from PTY */
  data: Uint8Array
  /** Whether more data is available */
  more: boolean
}

/**
 * UNIX user information required for session registration.
 * Must match the broker's UserInfo struct.
 */
export interface UserInfo {
  /** System username */
  username: string
  /** UNIX user ID */
  uid: number
  /** UNIX primary group ID */
  gid: number
  /** Home directory path */
  home: string
  /** Login shell path */
  shell: string
}

/**
 * Result of a PTY spawn operation.
 */
export interface SpawnPtyResult {
  /** Whether the spawn succeeded */
  success: boolean
  /** PTY session ID (present on success) */
  ptyId?: string
  /** Process ID of the spawned shell (present on success) */
  pid?: number
  /** Error message (present on failure) */
  error?: string
}

/**
 * Options for spawning a PTY session.
 */
export interface SpawnPtyOptions {
  /** Terminal type (default: "xterm-256color") */
  term?: string
  /** Column count (default: 80) */
  cols?: number
  /** Row count (default: 24) */
  rows?: number
  /** Additional environment variables */
  env?: Record<string, string>
}

/**
 * Result of an authentication attempt.
 */
export type AuthFailureCode = "auth_failed" | "broker_unavailable" | "rate_limit_exceeded"

export type BrokerUnavailableReason =
  | "socket_missing"
  | "conn_refused"
  | "timeout"
  | "invalid_response"
  | "connection_closed"
  | "unknown"

export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean
  /** Error message if failed (generic, no internal details) */
  error?: string
  /** Failure classification for client handling */
  code?: AuthFailureCode
  /** Broker unavailability reason */
  reason?: BrokerUnavailableReason
  /** Retry-after seconds for broker-side rate limiting */
  retryAfterSeconds?: number
}

const RATE_LIMIT_PREFIX = "too many authentication attempts"

function parseRetryAfterSeconds(message: string): number | undefined {
  const lower = message.toLowerCase()
  const marker = "retry after"
  const idx = lower.indexOf(marker)
  if (idx === -1) return undefined
  const tail = message.slice(idx + marker.length).trim()
  if (!tail) return undefined

  const token = tail.split(",")[0]?.trim() ?? ""
  if (!token) return undefined

  const pattern = /([0-9.]+)\s*(ms|s|m|h)/gi
  let totalSeconds = 0
  let matched = false
  let match: RegExpExecArray | null

  while ((match = pattern.exec(token))) {
    const value = Number.parseFloat(match[1] ?? "")
    if (!Number.isFinite(value)) continue
    matched = true
    const unit = (match[2] ?? "s").toLowerCase()
    const multiplier = unit === "ms" ? 0.001 : unit === "s" ? 1 : unit === "m" ? 60 : 3600
    totalSeconds += value * multiplier
  }

  if (!matched) return undefined
  return Math.max(1, Math.ceil(totalSeconds))
}

function classifyBrokerError(error: unknown): { reason: BrokerUnavailableReason; message: string } {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown broker error"
  const code = typeof error === "object" && error
    ? (error as { code?: string }).code
    : undefined
  const normalized = message.toLowerCase()

  if (code === "ENOENT" || normalized.includes("socket not found")) {
    return { reason: "socket_missing", message }
  }
  if (code === "ECONNREFUSED" || normalized.includes("connrefused")) {
    return { reason: "conn_refused", message }
  }
  if (normalized.includes("timeout")) {
    return { reason: "timeout", message }
  }
  if (normalized.includes("invalid response")) {
    return { reason: "invalid_response", message }
  }
  if (normalized.includes("connection closed")) {
    return { reason: "connection_closed", message }
  }

  return { reason: "unknown", message }
}

/**
 * Result of OTP server configuration check.
 *
 * Provides detailed information about why 2FA might not be working,
 * allowing administrators to diagnose and fix server misconfigurations.
 */
export interface OtpConfigResult {
  /** Whether all configuration is valid and ready for OTP validation */
  configured: boolean
  /** Whether pam_google_authenticator.so module is installed */
  pamModuleInstalled: boolean
  /** Path where PAM module was found (or expected path if not found) */
  pamModulePath: string
  /** Whether /etc/pam.d/opencode-otp service file exists */
  pamServiceExists: boolean
  /** Path to PAM service file */
  pamServicePath: string
  /** If the service file was auto-created by the broker */
  serviceAutoCreated: boolean
  /**
   * Specific error code if not configured:
   * - "pam_module_not_installed": google-authenticator PAM module not found
   * - "pam_service_not_configured": /etc/pam.d/opencode-otp missing and couldn't be created
   */
  errorCode?: string
}

/**
 * Result of setup OTP file creation.
 */
export interface SetupOtpResult {
  /** Whether the file was written */
  written: boolean
  /** Whether the file already existed */
  alreadyConfigured: boolean
  /** Error code when setup failed */
  errorCode?: string
}

/**
 * Result of removing OTP configuration.
 */
export interface RemoveOtpResult {
  /** Whether the file was removed */
  removed: boolean
  /** Whether the file was already missing */
  alreadyMissing: boolean
  /** Error code when removal failed */
  errorCode?: string
}

/**
 * Client for communicating with the opencode auth broker via Unix socket IPC.
 *
 * The broker is a privileged Rust daemon that handles PAM authentication.
 * This client sends authentication requests and receives success/failure responses.
 *
 * @example
 * ```typescript
 * const client = new BrokerClient()
 * const result = await client.authenticate("username", "password")
 * if (result.success) {
 *   // Create session
 * }
 * ```
 */
export class BrokerClient {
  private log = Log.create({ service: "broker-client" })
  private socketPath: string
  private timeoutMs: number

  constructor(options: { socketPath?: string; timeoutMs?: number } = {}) {
    // Default socket path based on platform
    // Linux uses /run (FHS 3.0), macOS uses /var/run
    this.socketPath =
      options.socketPath ?? (process.platform === "darwin" ? "/var/run/opencode/auth.sock" : "/run/opencode/auth.sock")
    this.timeoutMs = options.timeoutMs ?? 30000
  }

  /**
   * Authenticate a user via the auth broker.
   *
   * @param username - System username to authenticate
   * @param password - User's password
   * @returns Authentication result with success status and optional error
   *
   * Note: Password is sent to the broker but never logged or stored client-side.
   */
  async authenticate(username: string, password: string): Promise<AuthResult> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "authenticate",
      username,
      password,
    }

    try {
      const response = await this.sendRequest(request)

      // Verify response ID matches request ID
      if (response.id !== id) {
        return {
          success: false,
          error: "authentication service unavailable",
          code: "broker_unavailable",
          reason: "invalid_response",
        }
      }

      if (!response.success) {
        const errorText = response.error ?? "authentication failed"
        if (errorText.toLowerCase().includes(RATE_LIMIT_PREFIX)) {
          return {
            success: false,
            error: errorText,
            code: "rate_limit_exceeded",
            retryAfterSeconds: parseRetryAfterSeconds(errorText),
          }
        }
        return {
          success: false,
          error: errorText,
          code: "auth_failed",
        }
      }

      return { success: true }
    } catch (error) {
      const classified = classifyBrokerError(error)
      return {
        success: false,
        error: "authentication service unavailable",
        code: "broker_unavailable",
        reason: classified.reason,
      }
    }
  }

  /**
   * Validate OTP code for user.
   *
   * @param username - Username to validate OTP for
   * @param code - The TOTP code entered by user
   * @returns Authentication result with success status and optional error
   *
   * Note: Code is sent to the broker but never logged or stored client-side.
   */
  async authenticateOtp(username: string, code: string): Promise<AuthResult> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "authenticateotp",
      username,
      code,
    }

    try {
      const response = await this.sendRequest(request)

      if (response.id !== id) {
        return {
          success: false,
          error: "authentication service unavailable",
        }
      }

      return {
        success: response.success,
        error: response.error,
      }
    } catch {
      return {
        success: false,
        error: "authentication service unavailable",
      }
    }
  }

  /**
   * Create ~/.google_authenticator for the session user.
   *
   * @param sessionId - Session ID from UserSession
   * @param secret - Base32 secret to write
   * @returns Setup result with status and optional error code
   */
  async setupOtp(sessionId: string, secret: string): Promise<SetupOtpResult> {
    const id = crypto.randomUUID()
    const unavailableResult: SetupOtpResult = {
      written: false,
      alreadyConfigured: false,
      errorCode: "broker_unavailable",
    }

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "setupotp",
      session_id: sessionId,
      secret,
    }

    try {
      const response = await this.sendRequest(request)
      if (response.id !== id) {
        return unavailableResult
      }

      const data = response.data
      return {
        written: data?.written ?? false,
        alreadyConfigured: data?.already_configured ?? false,
        errorCode: data?.error_code ?? (response.success ? undefined : response.error),
      }
    } catch {
      return unavailableResult
    }
  }

  /**
   * Remove ~/.google_authenticator for the session user.
   *
   * @param sessionId - Session ID from UserSession
   * @returns Remove result with status and optional error code
   */
  async removeOtp(sessionId: string): Promise<RemoveOtpResult> {
    const id = crypto.randomUUID()
    const unavailableResult: RemoveOtpResult = {
      removed: false,
      alreadyMissing: false,
      errorCode: "broker_unavailable",
    }

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "removeotp",
      session_id: sessionId,
      confirm: true,
    }

    try {
      const response = await this.sendRequest(request)
      if (response.id !== id) {
        return unavailableResult
      }

      const data = response.data
      return {
        removed: data?.removed ?? false,
        alreadyMissing: data?.already_missing ?? false,
        errorCode: data?.error_code ?? (response.success ? undefined : response.error),
      }
    } catch {
      return unavailableResult
    }
  }

  /**
   * Ping the auth broker to check if it's running.
   *
   * @returns true if broker responds, false otherwise
   */
  async ping(): Promise<boolean> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "ping",
    }

    try {
      const response = await this.sendRequest(request)
      return response.id === id && response.success
    } catch {
      return false
    }
  }

  /**
   * Check if user has 2FA configured.
   *
   * @param username - Username to check
   * @param home - User's home directory (for .google_authenticator check)
   * @returns true if user has 2FA configured, false otherwise
   */
  async check2fa(username: string, home: string): Promise<boolean> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "check2fa",
      username,
      home,
    }

    try {
      const response = await this.sendRequest(request)
      return response.id === id && response.success
    } catch {
      // On error, assume no 2FA (fail open for detection)
      return false
    }
  }

  /**
   * Check OTP server configuration.
   *
   * Verifies that the server is properly configured for 2FA/OTP validation:
   * 1. PAM google_authenticator module is installed
   * 2. PAM service file exists at /etc/pam.d/opencode-otp
   *
   * If the service file is missing and the broker has permissions,
   * it will attempt to auto-create it.
   *
   * Use this to provide helpful error messages when OTP validation fails
   * due to server misconfiguration rather than invalid codes.
   *
   * @returns OtpConfigResult with detailed configuration status
   *
   * @example
   * ```typescript
   * const config = await client.checkOtpConfig()
   * if (!config.configured) {
   *   if (config.errorCode === "pam_module_not_installed") {
   *     console.error("Install google-authenticator: sudo apt install libpam-google-authenticator")
   *   } else if (config.errorCode === "pam_service_not_configured") {
   *     console.error(`Create PAM service file: ${config.pamServicePath}`)
   *   }
   * }
   * ```
   */
  async checkOtpConfig(): Promise<OtpConfigResult> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "checkotpconfig",
    }

    // Default result when broker is unavailable
    const unavailableResult: OtpConfigResult = {
      configured: false,
      pamModuleInstalled: false,
      pamModulePath: "",
      pamServiceExists: false,
      pamServicePath: "/etc/pam.d/opencode-otp",
      serviceAutoCreated: false,
      errorCode: "broker_unavailable",
    }

    try {
      const response = await this.sendRequest(request)

      if (response.id !== id) {
        return unavailableResult
      }

      // Map snake_case response to camelCase
      const data = response.data
      return {
        configured: data?.configured ?? false,
        pamModuleInstalled: data?.pam_module_installed ?? false,
        pamModulePath: data?.pam_module_path ?? "",
        pamServiceExists: data?.pam_service_exists ?? false,
        pamServicePath: data?.pam_service_path ?? "/etc/pam.d/opencode-otp",
        serviceAutoCreated: data?.service_auto_created ?? false,
        errorCode: data?.error_code ?? response.error,
      }
    } catch {
      return unavailableResult
    }
  }

  /**
   * Register a session with user info after successful authentication.
   *
   * Must be called before spawning PTY sessions for this user.
   * The broker stores the user info so it knows how to run processes
   * with the correct UID/GID when spawnPty is called.
   *
   * @param sessionId - Session ID from UserSession
   * @param userInfo - UNIX user information (uid, gid, home, shell)
   * @returns true if registration succeeded, false otherwise
   *
   * @example
   * ```typescript
   * // After successful authentication
   * const session = UserSession.create(username, userAgent, userInfo)
   *
   * // Register session with broker for PTY spawning
   * const registered = await client.registerSession(session.id, {
   *   username: session.username,
   *   uid: session.uid!,
   *   gid: session.gid!,
   *   home: session.home!,
   *   shell: session.shell!,
   * })
   * ```
   */
  async registerSession(sessionId: string, userInfo: UserInfo): Promise<boolean> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "registersession",
      session_id: sessionId,
      username: userInfo.username,
      uid: userInfo.uid,
      gid: userInfo.gid,
      home: userInfo.home,
      shell: userInfo.shell,
    }

    try {
      const response = await this.sendRequest(request)
      return response.id === id && response.success
    } catch {
      return false
    }
  }

  /**
   * Unregister a session on logout.
   *
   * This notifies the broker that the session is no longer valid.
   * The broker will clean up any associated PTY sessions.
   * This operation is idempotent - calling it multiple times is safe.
   *
   * @param sessionId - Session ID to unregister
   * @returns true if unregistration succeeded, false otherwise
   *
   * @example
   * ```typescript
   * // On logout
   * await client.unregisterSession(session.id)
   * UserSession.remove(session.id)
   * ```
   */
  async unregisterSession(sessionId: string): Promise<boolean> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "unregistersession",
      session_id: sessionId,
    }

    try {
      const response = await this.sendRequest(request)
      return response.id === id && response.success
    } catch {
      return false
    }
  }

  /**
   * Spawn a PTY session as the authenticated user.
   *
   * The session must be registered first via registerSession().
   * The spawned process runs with the user's UID/GID and has their
   * login shell as the command.
   *
   * @param sessionId - Session ID from web authentication (must be registered)
   * @param options - PTY configuration options
   * @returns Result with PTY ID and PID on success, error on failure
   *
   * @example
   * ```typescript
   * // After successful login and session registration
   * await client.registerSession(session.id, {
   *   username: session.username,
   *   uid: session.uid!,
   *   gid: session.gid!,
   *   home: session.home!,
   *   shell: session.shell!,
   * })
   *
   * // Spawn PTY
   * const result = await client.spawnPty(session.id, { cols: 80, rows: 24 })
   * if (result.success) {
   *   console.log(`PTY ${result.ptyId} spawned with PID ${result.pid}`)
   * }
   * ```
   */
  async spawnPty(sessionId: string, options: SpawnPtyOptions = {}, requestId?: string): Promise<SpawnPtyResult> {
    const id = crypto.randomUUID()
    this.log.info("broker request", { method: "spawnpty", sessionId, requestId })

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "spawnpty",
      session_id: sessionId,
      term: options.term ?? "xterm-256color",
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      env: options.env ?? {},
    }

    try {
      const response = await this.sendRequest(request)

      if (response.id !== id) {
        this.log.warn("broker invalid response", { method: "spawnpty", sessionId, requestId })
        return { success: false, error: "invalid response" }
      }

      if (!response.success) {
        this.log.warn("broker spawnpty failed", { method: "spawnpty", sessionId, requestId, error: response.error })
        return { success: false, error: response.error ?? "spawn failed" }
      }

      return {
        success: true,
        ptyId: response.data?.pty_id,
        pid: response.data?.pid,
      }
    } catch {
      this.log.warn("broker spawnpty unavailable", { method: "spawnpty", sessionId, requestId })
      return { success: false, error: "broker unavailable" }
    }
  }

  /**
   * Kill a PTY session.
   *
   * Terminates the process running in the PTY and cleans up resources.
   *
   * @param ptyId - PTY session ID to kill
   * @returns true if the PTY was killed, false otherwise
   *
   * @example
   * ```typescript
   * // When user closes terminal tab
   * await client.killPty(ptyId)
   * ```
   */
  async killPty(ptyId: string, requestId?: string): Promise<boolean> {
    const id = crypto.randomUUID()
    this.log.info("broker request", { method: "killpty", ptyId, requestId })

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "killpty",
      pty_id: ptyId,
    }

    try {
      const response = await this.sendRequest(request)
      if (response.id !== id || !response.success) {
        this.log.warn("broker killpty failed", { method: "killpty", ptyId, requestId, error: response.error })
      }
      return response.id === id && response.success
    } catch {
      this.log.warn("broker killpty unavailable", { method: "killpty", ptyId, requestId })
      return false
    }
  }

  /**
   * Resize a PTY session.
   *
   * Updates the terminal dimensions for the PTY. The running process
   * will receive a SIGWINCH signal to notify it of the size change.
   *
   * @param ptyId - PTY session ID to resize
   * @param cols - New column count
   * @param rows - New row count
   * @returns true if resize succeeded, false otherwise
   *
   * @example
   * ```typescript
   * // When browser window is resized
   * await client.resizePty(ptyId, 120, 40)
   * ```
   */
  async resizePty(ptyId: string, cols: number, rows: number, requestId?: string): Promise<boolean> {
    const id = crypto.randomUUID()
    this.log.info("broker request", { method: "resizepty", ptyId, cols, rows, requestId })

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "resizepty",
      pty_id: ptyId,
      cols,
      rows,
    }

    try {
      const response = await this.sendRequest(request)
      if (response.id !== id || !response.success) {
        this.log.warn("broker resizepty failed", { method: "resizepty", ptyId, cols, rows, requestId, error: response.error })
      }
      return response.id === id && response.success
    } catch {
      this.log.warn("broker resizepty unavailable", { method: "resizepty", ptyId, cols, rows, requestId })
      return false
    }
  }

  /**
   * Write data to a PTY.
   *
   * Sends data to the PTY's master fd via the broker.
   * Data is base64-encoded for transport over JSON IPC.
   *
   * @param ptyId - PTY session ID
   * @param data - Data to write (string or bytes)
   * @returns true if write succeeded, false otherwise
   *
   * @example
   * ```typescript
   * // Send user input to PTY
   * await client.ptyWrite(ptyId, "ls -la\n")
   * ```
   */
  async ptyWrite(ptyId: string, data: string | Uint8Array, requestId?: string): Promise<boolean> {
    const id = crypto.randomUUID()

    // Convert to base64
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
    const base64 = Buffer.from(bytes).toString("base64")

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "ptywrite",
      pty_id: ptyId,
      data: base64,
    }

    try {
      const response = await this.sendRequest(request)
      if (response.id !== id || !response.success) {
        this.log.warn("broker ptywrite failed", { method: "ptywrite", ptyId, requestId, error: response.error })
      }
      return response.id === id && response.success
    } catch {
      this.log.warn("broker ptywrite unavailable", { method: "ptywrite", ptyId, requestId })
      return false
    }
  }

  /**
   * Read data from a PTY.
   *
   * Reads available output from the PTY's master fd via the broker.
   * Data is base64-encoded for transport over JSON IPC.
   *
   * Note: This is a polling-based approach. For efficient streaming,
   * a push-based mechanism would be needed (future work).
   *
   * @param ptyId - PTY session ID
   * @param maxBytes - Maximum bytes to read (0 = all available, default: 4096)
   * @returns Read result with data and more flag, or null on failure
   *
   * @example
   * ```typescript
   * const result = await client.ptyRead(ptyId)
   * if (result) {
   *   const text = new TextDecoder().decode(result.data)
   *   console.log(text)
   * }
   * ```
   */
  async ptyRead(ptyId: string, maxBytes = 4096, requestId?: string): Promise<PtyReadResult | null> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "ptyread",
      pty_id: ptyId,
      max_bytes: maxBytes,
    }

    try {
      const response = await this.sendRequest(request)
      if (response.id !== id || !response.success || !response.data) {
        this.log.warn("broker ptyread failed", { method: "ptyread", ptyId, maxBytes, requestId, error: response.error })
        return null
      }

      const base64Data = response.data.data
      if (typeof base64Data !== "string") {
        return null
      }

      const decoded = Buffer.from(base64Data, "base64")
      return {
        data: new Uint8Array(decoded),
        more: response.data.more ?? false,
      }
    } catch {
      this.log.warn("broker ptyread unavailable", { method: "ptyread", ptyId, maxBytes, requestId })
      return null
    }
  }

  /**
   * Send a request to the broker and wait for response.
   *
   * Uses newline-delimited JSON protocol:
   * 1. Connect to Unix socket
   * 2. Write JSON + newline
   * 3. Read response line
   * 4. Parse JSON response
   * 5. Close connection
   */
  private async sendRequest(request: BrokerRequest): Promise<BrokerResponse> {
    // First, check if the socket file exists (fast-fail for ENOENT)
    // This avoids Bun's sync error throw on createConnection to non-existent paths
    const { existsSync } = await import("fs")
    if (!existsSync(this.socketPath)) {
      throw new Error("socket not found")
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error("timeout"))
        }
      }, this.timeoutMs)

      let socket: Socket | null = null
      let responseData = ""

      const cleanup = () => {
        clearTimeout(timeout)
        if (socket) {
          socket.removeAllListeners()
          socket.destroy()
          socket = null
        }
      }

      // Create socket and attach error handler FIRST before any other operations
      socket = createConnection({ path: this.socketPath })

      // Error handler must be attached immediately to catch ECONNREFUSED, etc.
      socket.on("error", (err: Error) => {
        if (!settled) {
          settled = true
          cleanup()
          reject(err)
        }
      })

      socket.on("connect", () => {
        // Connected - write request
        const message = JSON.stringify(request) + "\n"
        socket!.write(message)
      })

      socket.on("data", (chunk: Buffer) => {
        responseData += chunk.toString()

        // Check if we have a complete line (newline-delimited)
        const newlineIndex = responseData.indexOf("\n")
        if (newlineIndex !== -1) {
          const line = responseData.substring(0, newlineIndex)

          if (!settled) {
            settled = true
            cleanup()

            try {
              const response = JSON.parse(line) as BrokerResponse
              resolve(response)
            } catch {
              reject(new Error("invalid response"))
            }
          }
        }
      })

      socket.on("close", () => {
        // If we haven't resolved yet, the connection closed unexpectedly
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error("connection closed"))
        }
      })
    })
  }
}
