import path from "path"
import os from "os"
import fs from "fs/promises"
import { Global } from "../global"
import z from "zod"
import { Filesystem } from "../util/filesystem"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

/**
 * Maps OpenClaw provider names to opencode provider names.
 * OpenClaw uses descriptive names like "google-antigravity", opencode uses short names like "google".
 */
const OPENCLAW_PROVIDER_MAP: Record<string, string> = {
  "google-antigravity": "google",
  "openai-codex": "openai",
  "minimax-portal": "minimax",
  anthropic: "anthropic",
  xai: "xai",
  mistral: "mistral",
  cohere: "cohere",
  groq: "groq",
  deepseek: "deepseek",
}

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    const data = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(() => ({}))
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  export async function set(key: string, info: Info) {
    const data = await all()
    await Filesystem.writeJson(filepath, { ...data, [key]: info }, 0o600)
  }

  export async function remove(key: string) {
    const data = await all()
    delete data[key]
    await Filesystem.writeJson(filepath, data, 0o600)
  }

  /**
   * Known OAuth token refresh endpoints per provider base name.
   * Each entry: { tokenUrl, clientId, clientSecret? }
   * If clientId is empty string, the refresh attempt is skipped (no known public client).
   */
  const OAUTH_REFRESH_ENDPOINTS: Record<string, { tokenUrl: string; clientId: string; clientSecret?: string }> = {
    google: {
      tokenUrl: "https://oauth2.googleapis.com/token",
      // Gemini CLI / Google AI Studio client credentials (public, same as Gemini CLI)
      clientId: "764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com",
      clientSecret: "d-FL95Q19q7MQmFpd7hHD0Ty",
    },
    anthropic: {
      tokenUrl: "https://console.anthropic.com/v1/oauth/token",
      // Anthropic's public client id (base64-encoded, same as Claude.ai)
      clientId: "9d1c250a-e61e-48f8-b396-8d4e3e816b3d",
    },
  }

  /**
   * Checks whether an OAuth token is expired (with a 60-second buffer).
   */
  export function isTokenExpired(auth: z.infer<typeof Oauth>): boolean {
    return Date.now() >= auth.expires - 60_000
  }

  /**
   * Attempts to refresh an OAuth token using the refresh token.
   * Returns the updated auth info on success, undefined if refresh is not supported or fails.
   * On success, automatically persists the new token to the auth store.
   *
   * Fail-soft: if refresh fails, the caller should still attempt the request
   * with the potentially-expired token rather than failing hard.
   */
  export async function tryRefreshToken(key: string, auth: z.infer<typeof Oauth>): Promise<z.infer<typeof Oauth> | undefined> {
    const baseProvider = key.replace(/-[^-]*$/, "") // strip account suffix
    const endpoints = OAUTH_REFRESH_ENDPOINTS[baseProvider] ?? OAUTH_REFRESH_ENDPOINTS[key]
    if (!endpoints || !endpoints.clientId) return undefined

    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: endpoints.clientId,
        ...(endpoints.clientSecret ? { client_secret: endpoints.clientSecret } : {}),
      })
      const resp = await fetch(endpoints.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
      if (!resp.ok) return undefined
      const json = await resp.json() as Record<string, unknown>
      if (typeof json.access_token !== "string") return undefined

      const updated: z.infer<typeof Oauth> = {
        ...auth,
        access: json.access_token,
        expires: typeof json.expires_in === "number" ? Date.now() + json.expires_in * 1000 : auth.expires + 3600_000,
        ...(typeof json.refresh_token === "string" ? { refresh: json.refresh_token } : {}),
      }
      await set(key, updated)
      return updated
    } catch {
      return undefined
    }
  }

  /**
   * Gets an auth credential for a provider, attempting token refresh if it's expired.
   * Uses fail-soft strategy: if refresh fails, returns the original (possibly expired) credential.
   */
  export async function getWithRefresh(providerID: string): Promise<Info | undefined> {
    const auth = await get(providerID)
    if (!auth) return undefined
    if (auth.type !== "oauth") return auth
    if (!isTokenExpired(auth)) return auth
    const refreshed = await tryRefreshToken(providerID, auth)
    return refreshed ?? auth // fail-soft: return expired token if refresh fails
  }

  /**
   * Attempts to find the OpenClaw data directory.
   * OpenClaw stores data in ~/.openclaw/.openclaw/ by convention.
   */
  function openclawDir(): string {
    return path.join(os.homedir(), ".openclaw", ".openclaw")
  }

  /**
   * Result of an OpenClaw import operation.
   */
  export type ImportResult = {
    imported: string[]
    skipped: string[]
    errors: string[]
  }

  /**
   * Imports credentials from an OpenClaw auth-profiles.json file.
   *
   * Searches for the file in standard OpenClaw agent directories.
   * Maps OpenClaw provider names to opencode provider names using OPENCLAW_PROVIDER_MAP.
   * For multi-account profiles (e.g. google-antigravity:user@gmail.com), creates
   * opencode credentials in the format "google-user@gmail.com".
   *
   * Returns a summary of what was imported, skipped (already exists), and errored.
   */
  export async function importFromOpenClaw(options?: { force?: boolean }): Promise<ImportResult> {
    const result: ImportResult = { imported: [], skipped: [], errors: [] }

    // Find auth-profiles.json — typically in agents/main/agent/ or agents/*/agent/
    const base = openclawDir()
    const candidates = [
      path.join(base, "agents", "main", "agent", "auth-profiles.json"),
      path.join(base, "auth-profiles.json"),
    ]

    // Also search agent subdirectories
    const agentsDir = path.join(base, "agents")
    const agentDirs = await fs.readdir(agentsDir).catch(() => [] as string[])
    for (const agent of agentDirs) {
      candidates.push(path.join(agentsDir, agent, "agent", "auth-profiles.json"))
    }

    let raw: unknown = undefined
    for (const candidate of candidates) {
      raw = await Filesystem.readJson<unknown>(candidate).catch(() => undefined)
      if (raw) break
    }

    if (!raw || typeof raw !== "object" || !("profiles" in raw)) {
      result.errors.push("No OpenClaw auth-profiles.json found")
      return result
    }

    const profiles = (raw as { profiles: Record<string, unknown> }).profiles

    for (const [profileKey, profileData] of Object.entries(profiles)) {
      try {
        // profileKey format: "provider:accountId" e.g. "google-antigravity:user@gmail.com"
        const colonIdx = profileKey.indexOf(":")
        const openclawProvider = colonIdx >= 0 ? profileKey.slice(0, colonIdx) : profileKey
        const accountId = colonIdx >= 0 ? profileKey.slice(colonIdx + 1) : "default"

        const opencodeProvider = OPENCLAW_PROVIDER_MAP[openclawProvider] ?? openclawProvider

        // Build the opencode credential key
        // If account is email-like or non-default, suffix it to provider
        const isDefault = accountId === "default"
        const credKey = isDefault ? opencodeProvider : `${opencodeProvider}-${accountId}`

        const existing = await get(credKey)
        if (existing && !options?.force) {
          result.skipped.push(credKey)
          continue
        }

        // Map OpenClaw profile to opencode auth format
        const profile = profileData as Record<string, unknown>
        let info: Info | undefined

        if (profile.type === "oauth" && typeof profile.access === "string" && typeof profile.refresh === "string") {
          info = {
            type: "oauth",
            access: profile.access,
            refresh: profile.refresh,
            expires: typeof profile.expires === "number" ? profile.expires : Date.now() + 3600_000,
            accountId: typeof profile.accountId === "string" ? profile.accountId : undefined,
          }
        } else if (profile.type === "api" && typeof profile.access === "string") {
          info = { type: "api", key: profile.access }
        }

        if (!info) {
          result.errors.push(`${profileKey}: unsupported auth format`)
          continue
        }

        await set(credKey, info)
        result.imported.push(credKey)
      } catch (e) {
        result.errors.push(`${profileKey}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return result
  }
}
