import z from "zod"
import { Duration } from "../util/duration"

/**
 * PAM-specific authentication configuration.
 */
export const AuthPamConfig = z
  .object({
    service: z.string().optional().default("opencode").describe("PAM service name"),
  })
  .strict()
  .meta({ ref: "AuthPamConfig" })

export type AuthPamConfig = z.infer<typeof AuthPamConfig>

/**
 * Authentication configuration for opencode.
 *
 * Controls whether authentication is enabled and how it behaves.
 * When enabled, users must authenticate with system credentials
 * before accessing the opencode instance.
 */
export const AuthConfig = z
  .object({
    enabled: z.boolean().optional().default(false).describe("Enable authentication"),
    method: z.enum(["pam"]).optional().default("pam").describe("Authentication method"),
    pam: AuthPamConfig.optional().describe("PAM-specific configuration"),
    sessionTimeout: Duration.optional().default("7d").describe("Session timeout duration"),
    rememberMeDuration: Duration.optional().default("90d").describe("Remember me cookie duration"),
    requireHttps: z
      .enum(["off", "warn", "block"])
      .optional()
      .default("warn")
      .describe("HTTPS requirement mode: 'off' allows HTTP, 'warn' logs warnings, 'block' rejects HTTP"),
    rateLimiting: z.boolean().optional().default(true).describe("Enable rate limiting for login attempts"),
    allowedUsers: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Users allowed to authenticate. Empty array allows any system user"),
    sessionPersistence: z.boolean().optional().default(true).describe("Persist sessions to disk across restarts"),
    trustProxy: z.boolean().optional().describe("Trust X-Forwarded-Proto header for reverse proxy detection"),
  })
  .strict()
  .meta({ ref: "AuthConfig" })

export type AuthConfig = z.infer<typeof AuthConfig>
