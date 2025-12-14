import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
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

  const PROFILE_DELIMITER = ":"
  const PROFILE_REGEX = /^[a-zA-Z0-9_-]+$/

  /** Parse composite key into provider and profile */
  export function parseKey(key: string): { providerID: string; profile?: string } {
    const idx = key.indexOf(PROFILE_DELIMITER)
    if (idx === -1) return { providerID: key }
    return {
      providerID: key.slice(0, idx),
      profile: key.slice(idx + 1),
    }
  }

  /** Build composite key from provider and profile */
  export function buildKey(providerID: string, profile?: string): string {
    if (!profile) return providerID
    return `${providerID}${PROFILE_DELIMITER}${profile}`
  }

  /** Validate profile name (alphanumeric, hyphen, underscore) */
  export function validateProfileName(name: string): boolean {
    return PROFILE_REGEX.test(name)
  }

  /** Get auth info for a provider, optionally with a specific profile */
  export async function get(providerID: string, profile?: string) {
    const auth = await all()
    const key = buildKey(providerID, profile)
    return auth[key]
  }

  export async function all(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)
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

  /** Set auth info for a provider, optionally with a profile name */
  export async function set(providerID: string, info: Info, profile?: string) {
    const file = Bun.file(filepath)
    const data = await all()
    const key = buildKey(providerID, profile)
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  /** Remove auth info for a provider, optionally with a specific profile */
  export async function remove(providerID: string, profile?: string) {
    const file = Bun.file(filepath)
    const data = await all()
    const key = buildKey(providerID, profile)
    delete data[key]
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  /** List all profiles for a provider */
  export async function profiles(providerID: string): Promise<Array<{ profile?: string; info: Info }>> {
    const data = await all()
    const result: Array<{ profile?: string; info: Info }> = []
    for (const [key, info] of Object.entries(data)) {
      const parsed = parseKey(key)
      if (parsed.providerID === providerID) {
        result.push({ profile: parsed.profile, info })
      }
    }
    return result
  }

  /** Check if default profile exists for provider */
  export async function hasDefault(providerID: string): Promise<boolean> {
    const data = await all()
    return providerID in data
  }

  /** Swap default with a named profile */
  export async function setDefault(providerID: string, profile: string): Promise<void> {
    const data = await all()
    const namedKey = buildKey(providerID, profile)
    const defaultKey = providerID

    const namedInfo = data[namedKey]
    if (!namedInfo) throw new ProfileNotFoundError({ providerID, profile })

    const defaultInfo = data[defaultKey]

    // Swap: named becomes default, old default becomes named
    const file = Bun.file(filepath)
    const newData = { ...data }
    newData[defaultKey] = namedInfo
    if (defaultInfo) {
      newData[namedKey] = defaultInfo
    } else {
      delete newData[namedKey]
    }
    await Bun.write(file, JSON.stringify(newData, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export const ProfileNotFoundError = NamedError.create(
    "AuthProfileNotFoundError",
    z.object({
      providerID: z.string(),
      profile: z.string(),
    }),
  )

  export const InvalidProfileNameError = NamedError.create(
    "AuthInvalidProfileNameError",
    z.object({
      profile: z.string(),
    }),
  )
}
