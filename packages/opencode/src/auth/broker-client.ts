import { createConnection, type Socket } from "net"

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
export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean
  /** Error message if failed (generic, no internal details) */
  error?: string
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
        }
      }

      return {
        success: response.success,
        error: response.error,
      }
    } catch {
      // Connection errors should not expose details
      return {
        success: false,
        error: "authentication service unavailable",
      }
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
  async spawnPty(sessionId: string, options: SpawnPtyOptions = {}): Promise<SpawnPtyResult> {
    const id = crypto.randomUUID()

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
        return { success: false, error: "invalid response" }
      }

      if (!response.success) {
        return { success: false, error: response.error ?? "spawn failed" }
      }

      return {
        success: true,
        ptyId: response.data?.pty_id,
        pid: response.data?.pid,
      }
    } catch {
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
  async killPty(ptyId: string): Promise<boolean> {
    const id = crypto.randomUUID()

    const request: BrokerRequest = {
      id,
      version: 1,
      method: "killpty",
      pty_id: ptyId,
    }

    try {
      const response = await this.sendRequest(request)
      return response.id === id && response.success
    } catch {
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
  async resizePty(ptyId: string, cols: number, rows: number): Promise<boolean> {
    const id = crypto.randomUUID()

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
      return response.id === id && response.success
    } catch {
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
  async ptyWrite(ptyId: string, data: string | Uint8Array): Promise<boolean> {
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
      return response.id === id && response.success
    } catch {
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
  async ptyRead(ptyId: string, maxBytes = 4096): Promise<PtyReadResult | null> {
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
