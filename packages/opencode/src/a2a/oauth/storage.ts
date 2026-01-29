import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "../../global"

export namespace A2AAuth {
  export const Tokens = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    scope: z.string().optional(),
  })
  export type Tokens = z.infer<typeof Tokens>

  export const Entry = z.object({
    tokens: Tokens.optional(),
    codeVerifier: z.string().optional(),
    oauthState: z.string().optional(),
    domain: z.string(),
  })
  export type Entry = z.infer<typeof Entry>

  const filepath = path.join(Global.Path.data, "a2a-auth.json")

  export async function get(domain: string): Promise<Entry | undefined> {
    const data = await all()
    return data[domain]
  }

  export async function all(): Promise<Record<string, Entry>> {
    const file = Bun.file(filepath)
    return file.json().catch(() => ({}))
  }

  export async function set(domain: string, entry: Entry): Promise<void> {
    const file = Bun.file(filepath)
    const data = await all()
    entry.domain = domain
    await Bun.write(file, JSON.stringify({ ...data, [domain]: entry }, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function remove(domain: string): Promise<void> {
    const file = Bun.file(filepath)
    const data = await all()
    delete data[domain]
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function updateTokens(domain: string, tokens: Tokens): Promise<void> {
    const entry = (await get(domain)) ?? { domain }
    entry.tokens = tokens
    await set(domain, entry)
  }

  export async function updateCodeVerifier(domain: string, codeVerifier: string): Promise<void> {
    const entry = (await get(domain)) ?? { domain }
    entry.codeVerifier = codeVerifier
    await set(domain, entry)
  }

  export async function getCodeVerifier(domain: string): Promise<string | undefined> {
    const entry = await get(domain)
    return entry?.codeVerifier
  }

  export async function clearCodeVerifier(domain: string): Promise<void> {
    const entry = await get(domain)
    if (entry) {
      delete entry.codeVerifier
      await set(domain, entry)
    }
  }

  export async function updateOAuthState(domain: string, oauthState: string): Promise<void> {
    const entry = (await get(domain)) ?? { domain }
    entry.oauthState = oauthState
    await set(domain, entry)
  }

  export async function getOAuthState(domain: string): Promise<string | undefined> {
    const entry = await get(domain)
    return entry?.oauthState
  }

  export async function clearOAuthState(domain: string): Promise<void> {
    const entry = await get(domain)
    if (entry) {
      delete entry.oauthState
      await set(domain, entry)
    }
  }

  export async function isTokenExpired(domain: string): Promise<boolean | null> {
    const entry = await get(domain)
    if (!entry?.tokens) return null
    if (!entry.tokens.expiresAt) return false
    return entry.tokens.expiresAt < Date.now() / 1000
  }

  export async function hasValidTokens(domain: string): Promise<boolean> {
    const entry = await get(domain)
    if (!entry?.tokens?.accessToken) return false
    const expired = await isTokenExpired(domain)
    if (expired === true) {
      return !!entry.tokens.refreshToken
    }
    return true
  }
}
