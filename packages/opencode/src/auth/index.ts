import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"

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

  export const ProviderAuth = z
    .object({
      accounts: z.record(z.string(), Info),
      active: z.string(),
    })
    .meta({ ref: "ProviderAuth" })
  export type ProviderAuth = z.infer<typeof ProviderAuth>

  export const AccountInfo = z
    .object({
      name: z.string(),
      type: z.enum(["oauth", "api", "wellknown"]),
      active: z.boolean(),
    })
    .meta({ ref: "AccountInfo" })
  export type AccountInfo = z.infer<typeof AccountInfo>

  const filepath = path.join(Global.Path.data, "auth.json")

  async function readRaw(): Promise<Record<string, ProviderAuth>> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)

    const result: Record<string, ProviderAuth> = {}

    for (const [providerID, value] of Object.entries(data)) {
      const providerAuth = ProviderAuth.safeParse(value)
      if (providerAuth.success) {
        result[providerID] = providerAuth.data
        continue
      }

      const legacyAuth = Info.safeParse(value)
      if (legacyAuth.success) {
        result[providerID] = {
          accounts: { default: legacyAuth.data },
          active: "default",
        }
        continue
      }
    }

    return result
  }

  async function writeRaw(data: Record<string, ProviderAuth>) {
    const file = Bun.file(filepath)
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function get(providerID: string): Promise<Info | undefined> {
    const data = await readRaw()
    const provider = data[providerID]
    if (!provider) return undefined
    return provider.accounts[provider.active]
  }

  export async function getAccount(providerID: string, accountName: string): Promise<Info | undefined> {
    const data = await readRaw()
    const provider = data[providerID]
    if (!provider) return undefined
    return provider.accounts[accountName]
  }

  export async function listAccounts(providerID: string): Promise<AccountInfo[]> {
    const data = await readRaw()
    const provider = data[providerID]
    if (!provider) return []
    return Object.entries(provider.accounts).map(([name, auth]) => ({
      name,
      type: auth.type,
      active: name === provider.active,
    }))
  }

  export async function all(): Promise<Record<string, Info>> {
    const data = await readRaw()
    const result: Record<string, Info> = {}
    for (const [providerID, provider] of Object.entries(data)) {
      const activeAuth = provider.accounts[provider.active]
      if (activeAuth) result[providerID] = activeAuth
    }
    return result
  }

  export async function allProviders(): Promise<Record<string, ProviderAuth>> {
    return readRaw()
  }

  export async function setAccount(providerID: string, accountName: string, info: Info) {
    const data = await readRaw()
    const existing = data[providerID]
    if (existing) {
      existing.accounts[accountName] = info
      if (Object.keys(existing.accounts).length === 1) {
        existing.active = accountName
      }
    } else {
      data[providerID] = {
        accounts: { [accountName]: info },
        active: accountName,
      }
    }
    await writeRaw(data)
  }

  export async function setActive(providerID: string, accountName: string): Promise<boolean> {
    const data = await readRaw()
    const provider = data[providerID]
    if (!provider || !provider.accounts[accountName]) return false
    provider.active = accountName
    await writeRaw(data)
    return true
  }

  export async function removeAccount(providerID: string, accountName: string): Promise<boolean> {
    const data = await readRaw()
    const provider = data[providerID]
    if (!provider || !provider.accounts[accountName]) return false

    delete provider.accounts[accountName]

    if (Object.keys(provider.accounts).length === 0) {
      delete data[providerID]
    } else if (provider.active === accountName) {
      provider.active = Object.keys(provider.accounts)[0]
    }

    await writeRaw(data)
    return true
  }

  export async function set(providerID: string, info: Info) {
    await setAccount(providerID, "default", info)
  }

  export async function remove(providerID: string) {
    const data = await readRaw()
    delete data[providerID]
    await writeRaw(data)
  }

  export async function getActive(providerID: string): Promise<string | undefined> {
    const data = await readRaw()
    const provider = data[providerID]
    return provider?.active
  }

  export async function hasAccounts(providerID: string): Promise<boolean> {
    const data = await readRaw()
    const provider = data[providerID]
    return provider ? Object.keys(provider.accounts).length > 0 : false
  }
}
