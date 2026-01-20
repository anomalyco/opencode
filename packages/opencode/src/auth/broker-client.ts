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
  method: "authenticate" | "ping"
  /** Username for authenticate method */
  username?: string
  /** Password for authenticate method */
  password?: string
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
