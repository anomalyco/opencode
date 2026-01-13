import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import crypto from "crypto"

export namespace AuthToken {
  export const Permission = z.enum(["read", "write", "execute"])
  export type Permission = z.infer<typeof Permission>

  export const ExpiryDuration = z.enum(["30d", "90d", "180d", "1y", "never"])
  export type ExpiryDuration = z.infer<typeof ExpiryDuration>

  export const Info = z
    .object({
      token: z.string().min(128, "Token must be at least 128 characters"),
      permissions: z.array(Permission),
      expiresAt: z.number().nullable(),
      createdAt: z.number(),
      name: z.string().optional(),
    })
    .meta({ ref: "AuthToken" })
  export type Info = z.infer<typeof Info>

  export const InvalidTokenError = NamedError.create(
    "InvalidTokenError",
    z.object({
      message: z.string(),
    }),
  )

  export const ExpiredTokenError = NamedError.create(
    "ExpiredTokenError",
    z.object({
      message: z.string(),
      expiredAt: z.number(),
    }),
  )

  export const InsufficientPermissionsError = NamedError.create(
    "InsufficientPermissionsError",
    z.object({
      message: z.string(),
      required: z.array(z.string()),
      granted: z.array(z.string()),
    }),
  )

  // Computed at call time to support test isolation
  function getFilepath(): string {
    return path.join(Global.Path.config, "auth-tokens.json")
  }

  function generateToken(): string {
    // Generate 768-bit (96 bytes) cryptographically secure random token
    // Results in 128 characters when base64url encoded
    return crypto.randomBytes(96).toString("base64url")
  }

  function calculateExpiry(duration: ExpiryDuration): number | null {
    if (duration === "never") return null

    const now = Date.now()
    const durations: Record<Exclude<ExpiryDuration, "never">, number> = {
      "30d": 30 * 24 * 60 * 60 * 1000,
      "90d": 90 * 24 * 60 * 60 * 1000,
      "180d": 180 * 24 * 60 * 60 * 1000,
      "1y": 365 * 24 * 60 * 60 * 1000,
    }

    return now + durations[duration as Exclude<ExpiryDuration, "never">]
  }

  export async function create(input: {
    permissions: Permission[]
    expiry: ExpiryDuration
    name?: string
  }): Promise<Info> {
    const token = generateToken()
    const info: Info = {
      token,
      permissions: input.permissions,
      expiresAt: calculateExpiry(input.expiry),
      createdAt: Date.now(),
      name: input.name,
    }

    const tokens = await all()
    tokens.push(info)
    await save(tokens)

    return info
  }

  export async function all(): Promise<Info[]> {
    const file = Bun.file(getFilepath())
    const exists = await file.exists()
    if (!exists) return []

    const data = await file.json().catch(() => [])
    if (!Array.isArray(data)) return []

    return data
      .map((item) => Info.safeParse(item))
      .filter((result) => result.success)
      .map((result) => result.data)
  }

  export async function get(token: string): Promise<Info | undefined> {
    const tokens = await all()
    return tokens.find((t) => t.token === token)
  }

  export async function remove(token: string): Promise<boolean> {
    const tokens = await all()
    const filtered = tokens.filter((t) => t.token !== token)
    if (filtered.length === tokens.length) return false

    await save(filtered)
    return true
  }

  export async function validate(token: string, requiredPermissions: Permission[]): Promise<Info> {
    const info = await get(token)
    if (!info) {
      throw new InvalidTokenError({ message: "Invalid authentication token" })
    }

    // Check expiry
    if (info.expiresAt !== null && Date.now() > info.expiresAt) {
      throw new ExpiredTokenError({
        message: "Authentication token has expired",
        expiredAt: info.expiresAt,
      })
    }

    // Check permissions
    const hasAllPermissions = requiredPermissions.every((required) => info.permissions.includes(required))

    if (!hasAllPermissions) {
      throw new InsufficientPermissionsError({
        message: "Insufficient permissions for this operation",
        required: requiredPermissions,
        granted: info.permissions,
      })
    }

    return info
  }

  async function save(tokens: Info[]): Promise<void> {
    const file = Bun.file(getFilepath())
    await Bun.write(file, JSON.stringify(tokens, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function regenerate(oldToken: string, expiry?: ExpiryDuration): Promise<Info> {
    const existing = await get(oldToken)
    if (!existing) {
      throw new InvalidTokenError({ message: "Token not found" })
    }

    // Create new token with same permissions
    const newToken = await create({
      permissions: existing.permissions,
      expiry: expiry ?? "never",
      name: existing.name,
    })

    // Remove old token
    await remove(oldToken)

    return newToken
  }
}

/**
 * Session tokens are ephemeral tokens generated when the server starts.
 * They are stored in a file that the TUI can read to authenticate automatically.
 * This provides seamless local authentication without manual token management.
 *
 * Security model:
 * - Session token file has 0600 permissions (only owner can read)
 * - Token is only valid while the server is running
 * - File is deleted when server stops
 * - Trust boundary is the filesystem - if someone can read your files, they own your machine
 */
export namespace SessionToken {
  export const Info = z
    .object({
      token: z.string().min(128, "Token must be at least 128 characters"),
      port: z.number(),
      hostname: z.string(),
      pid: z.number(),
      createdAt: z.number(),
    })
    .meta({ ref: "SessionToken" })
  export type Info = z.infer<typeof Info>

  // Session token file location
  function getFilepath(): string {
    return path.join(Global.Path.config, "server-session.json")
  }

  function generateToken(): string {
    // Generate 768-bit (96 bytes) cryptographically secure random token
    return crypto.randomBytes(96).toString("base64url")
  }

  /**
   * Create and write a session token when the server starts.
   * Returns the generated token for use by the server.
   */
  export async function create(opts: { port: number; hostname: string }): Promise<Info> {
    const info: Info = {
      token: generateToken(),
      port: opts.port,
      hostname: opts.hostname,
      pid: process.pid,
      createdAt: Date.now(),
    }

    const filepath = getFilepath()
    const dir = path.dirname(filepath)

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true })

    // Write session file with secure permissions
    const file = Bun.file(filepath)
    await Bun.write(file, JSON.stringify(info, null, 2))
    await fs.chmod(filepath, 0o600)

    return info
  }

  /**
   * Read the current session token if it exists.
   * Used by the TUI to authenticate with the server.
   */
  export async function read(): Promise<Info | null> {
    const filepath = getFilepath()
    const file = Bun.file(filepath)

    const exists = await file.exists()
    if (!exists) return null

    try {
      const data = await file.json()
      const parsed = Info.safeParse(data)
      if (!parsed.success) return null

      // Verify the server process is still running
      if (!isProcessRunning(parsed.data.pid)) {
        // Stale session file - clean it up
        await remove()
        return null
      }

      return parsed.data
    } catch {
      return null
    }
  }

  /**
   * Remove the session token file when the server stops.
   */
  export async function remove(): Promise<void> {
    const filepath = getFilepath()
    try {
      await fs.unlink(filepath)
    } catch {
      // Ignore errors if file doesn't exist
    }
  }

  /**
   * Validate a token against the session token.
   * Returns true if the token matches the current session.
   */
  export async function validate(token: string): Promise<boolean> {
    const session = await read()
    if (!session) return false
    return session.token === token
  }

  /**
   * Check if a process is still running.
   */
  function isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without actually signaling it
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}
