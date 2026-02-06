import z from "zod"

const durationPattern = /^\d+(?:\.\d+)?(?:ms|s|m|h|d|w|y)$/

const Duration = z
  .string()
  .refine((value) => durationPattern.test(value), {
    message: "Invalid duration format. Use formats like '30m', '1h', '7d'",
  })
  .describe("Duration string (e.g., '30m', '1h', '7d')")
  .meta({ ref: "DurationString" })

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
    enabled: z.boolean().optional().default(true).describe("Enable authentication"),
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
    rateLimitWindow: Duration.optional().default("15m").describe("Rate limit window duration (e.g., '15m', '1h')"),
    rateLimitMax: z.number().optional().default(5).describe("Maximum login attempts per window"),
    allowedUsers: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Users allowed to authenticate. Empty array allows any system user"),
    sessionPersistence: z.boolean().optional().default(true).describe("Persist sessions to disk across restarts"),
    trustProxy: z.boolean().optional().describe("Trust X-Forwarded-Proto header for reverse proxy detection"),
    csrfVerboseErrors: z
      .boolean()
      .optional()
      .default(false)
      .describe("Enable verbose CSRF error messages for debugging"),
    debugBrokerErrors: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include broker error details in login responses for debugging"),
    csrfAllowlist: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Additional routes to exclude from CSRF validation"),
    twoFactorEnabled: z.boolean().optional().default(true).describe("Enable two-factor authentication support"),
    twoFactorRequired: z
      .boolean()
      .optional()
      .default(false)
      .describe("Require users to set up 2FA before accessing the app (implies twoFactorEnabled)"),
    twoFactorTokenTimeout: Duration.optional()
      .default("5m")
      .describe("How long the 2FA token is valid after password success"),
    deviceTrustDuration: Duration.optional().default("30d").describe("How long 'remember this device' lasts for 2FA"),
    otpRateLimitMax: z.number().optional().default(5).describe("Maximum OTP attempts per rate limit window"),
    otpRateLimitWindow: Duration.optional().default("15m").describe("OTP rate limit window duration"),
  })
  .strict()
  .meta({ ref: "AuthConfig" })

export type AuthConfig = z.infer<typeof AuthConfig>
