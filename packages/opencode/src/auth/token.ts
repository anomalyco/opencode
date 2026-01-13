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
