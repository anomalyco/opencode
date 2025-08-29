import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import { z } from "zod"
import { Keychain } from "./keychain"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
    })
    .openapi({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .openapi({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .openapi({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).openapi({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  async function readFileMap(): Promise<Record<string, unknown>> {
    const file = Bun.file(filepath)
    return file.json().catch(() => ({} as Record<string, unknown>))
  }

  async function writeFileMap(data: Record<string, unknown>) {
    const file = Bun.file(filepath)
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600).catch(() => {})
  }

  function safeParseInfo(value: unknown): Info | undefined {
    const res = Info.safeParse(value)
    return res.success ? res.data : undefined
  }

  export async function get(providerID: string): Promise<Info | undefined> {
    // 1) Try keychain first
    const fromKC = await Keychain.get(providerID)
    if (fromKC) {
      const parsed = safeParseInfo(safeJSONParse(fromKC))
      if (parsed) return parsed
    }

    // 2) Fallback to file (migration path)
    const map = await readFileMap()
    const raw = map[providerID]
    const info = safeParseInfo(raw)
    if (!info) return undefined

    // Migrate this entry to keychain and remove from file
    await Keychain.set(providerID, JSON.stringify(info))
    delete map[providerID]
    try {
      await writeFileMap(map)
    } catch {}
    return info
  }

  export async function all(): Promise<Record<string, Info>> {
    const result: Record<string, Info> = {}

    // 1) Read all from keychain
    const creds = await Keychain.list()
    for (const { account, password } of creds) {
      const parsed = safeParseInfo(safeJSONParse(password))
      if (parsed) result[account] = parsed
    }

    // 2) Read file for any entries not yet in keychain (migrate them)
    const fileMap = await readFileMap()
    let changed = false
    for (const [providerID, value] of Object.entries(fileMap)) {
      if (result[providerID]) continue
      const info = safeParseInfo(value)
      if (!info) continue
      await Keychain.set(providerID, JSON.stringify(info))
      result[providerID] = info
      delete fileMap[providerID]
      changed = true
    }
    if (changed) {
      try {
        await writeFileMap(fileMap)
      } catch {}
    }

    return result
  }

  export async function set(key: string, info: Info) {
    // Validate
    Info.parse(info)
    // Write to keychain
    await Keychain.set(key, JSON.stringify(info))

    // Ensure it's removed from file map if present
    const map = await readFileMap()
    if (map[key] !== undefined) {
      delete map[key]
      try {
        await writeFileMap(map)
      } catch {}
    }
  }

  export async function remove(key: string) {
    await Keychain.remove(key)

    // Remove from file map if present
    const map = await readFileMap()
    if (map[key] !== undefined) {
      delete map[key]
      try {
        await writeFileMap(map)
      } catch {}
    }
  }
}

function safeJSONParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
