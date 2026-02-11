import path from "path"
import { Global } from "../global"
import z from "zod"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

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

  // New profile-based schema
  export const Provider = z
    .object({
      profiles: z.record(z.string(), Info),
      currentProfile: z.string().optional(),
    })
    .meta({ ref: "Provider" })
  export type Provider = z.infer<typeof Provider>

  // Union of legacy and new formats
  export const ProviderOrInfo = z.union([Info, Provider]).meta({ ref: "ProviderOrInfo" })
  export type ProviderOrInfo = z.infer<typeof ProviderOrInfo>

  const filepath = path.join(Global.Path.data, "auth.json")

  // Storage format: Record<string, ProviderOrInfo>
  type StorageFormat = Record<string, ProviderOrInfo>

  // Internal data after processing: Record<string, Provider>
  type InternalFormat = Record<string, Provider>

  async function getRaw(): Promise<StorageFormat> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)
    return Object.entries(data).reduce((acc, [key, value]) => {
      const parsed = ProviderOrInfo.safeParse(value)
      if (!parsed.success) return acc
      acc[key] = parsed.data
      return acc
    }, {} as StorageFormat)
  }

  function normalizeToInternal(data: StorageFormat): InternalFormat {
    const normalized: InternalFormat = {}

    for (const [providerID, value] of Object.entries(data)) {
      if (Info.safeParse(value).success) {
        // Legacy format - convert to profile-based
        normalized[providerID] = {
          profiles: {
            default: value as Info,
          },
          currentProfile: "default",
        }
      } else {
        // Already in new format
        normalized[providerID] = value as Provider
      }
    }

    return normalized
  }

  export async function get(providerID: string, profileID?: string): Promise<Info | undefined> {
    const authData = await allWithProfiles()
    const provider = authData[providerID]
    if (!provider) return undefined

    if (profileID) {
      return provider.profiles[profileID]
    }

    const currentProfile = provider.currentProfile || "default"
    return provider.profiles[currentProfile]
  }

  export async function all(): Promise<Record<string, Info>> {
    const raw = await getRaw()
    const normalized = normalizeToInternal(raw)

    // Return only current profiles for backward compatibility
    const result: Record<string, Info> = {}
    for (const [providerID, provider] of Object.entries(normalized)) {
      const currentProfile = provider.currentProfile || "default"
      const currentAuth = provider.profiles[currentProfile]
      if (currentAuth) {
        result[providerID] = currentAuth
      }
    }

    return result
  }

  export async function allWithProfiles(): Promise<Record<string, Provider>> {
    const raw = await getRaw()
    return normalizeToInternal(raw)
  }

  export async function set(key: string, info: Info, profileID: string = "default"): Promise<void> {
    const raw = await getRaw()
    const normalized = normalizeToInternal(raw)

    if (!normalized[key]) {
      normalized[key] = {
        profiles: {},
        currentProfile: profileID,
      }
    }

    normalized[key].profiles[profileID] = info
    if (!normalized[key].currentProfile) {
      normalized[key].currentProfile = profileID
    }

    await Bun.write(filepath, JSON.stringify(normalized, null, 2), { mode: 0o600 })
  }

  export async function remove(key: string): Promise<void> {
    const raw = await getRaw()
    delete raw[key]
    await Bun.write(filepath, JSON.stringify(raw, null, 2), { mode: 0o600 })
  }

  // Profile management functions
  export async function getProfile(providerID: string, profileID: string): Promise<Info | undefined> {
    const auth = await allWithProfiles()
    return auth[providerID]?.profiles[profileID]
  }

  export async function listProfiles(providerID: string): Promise<Record<string, Info>> {
    const auth = await allWithProfiles()
    return auth[providerID]?.profiles || {}
  }

  export async function setActiveProfile(providerID: string, profileID: string): Promise<void> {
    const auth = await allWithProfiles()
    const provider = auth[providerID]
    if (!provider || !provider.profiles[profileID]) {
      throw new Error(`Profile "${profileID}" not found for provider "${providerID}"`)
    }

    provider.currentProfile = profileID
    await Bun.write(filepath, JSON.stringify(auth, null, 2), { mode: 0o600 })
  }

  export async function addProfile(providerID: string, profileID: string, info: Info): Promise<void> {
    validateProfileName(profileID)
    const auth = await allWithProfiles()

    if (!auth[providerID]) {
      auth[providerID] = {
        profiles: {},
        currentProfile: profileID,
      }
    }

    auth[providerID].profiles[profileID] = info
    if (!auth[providerID].currentProfile) {
      auth[providerID].currentProfile = profileID
    }

    await Bun.write(filepath, JSON.stringify(auth, null, 2), { mode: 0o600 })
  }

  export async function removeProfile(providerID: string, profileID: string): Promise<void> {
    const auth = await allWithProfiles()
    const provider = auth[providerID]
    if (!provider) return

    delete provider.profiles[profileID]

    // If removing current profile, switch to first available
    if (provider.currentProfile === profileID) {
      const availableProfiles = Object.keys(provider.profiles)
      if (availableProfiles.length > 0) {
        provider.currentProfile = availableProfiles[0]
      } else {
        // No profiles left, remove the entire provider
        delete auth[providerID]
      }
    }

    await Bun.write(filepath, JSON.stringify(auth, null, 2), { mode: 0o600 })
  }

  export async function migrate(): Promise<boolean> {
    const raw = await getRaw()
    let needsMigration = false

    // Check if any entries are in legacy format
    for (const [_, value] of Object.entries(raw)) {
      if (Info.safeParse(value).success) {
        needsMigration = true
        break
      }
    }

    if (needsMigration) {
      const normalized = normalizeToInternal(raw)
      await Bun.write(filepath, JSON.stringify(normalized, null, 2), { mode: 0o600 })
      return true
    }

    return false
  }

  export function validateProfileName(profileID: string): void {
    if (!profileID || !profileID.trim()) {
      throw new Error("Profile name cannot be empty")
    }
    if (profileID.length > 50) {
      throw new Error("Profile name too long (maximum 50 characters)")
    }
    if (profileID.includes("/") || profileID.includes("\\")) {
      throw new Error("Profile name cannot contain slashes (/ or \\)")
    }
    if (profileID.includes("..")) {
      throw new Error("Profile name cannot contain parent directory references (..)")
    }
    if (/^[\s]/.test(profileID) || /[\s]$/.test(profileID)) {
      throw new Error("Profile name cannot start or end with whitespace")
    }
  }

}
