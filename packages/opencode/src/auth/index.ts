import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
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

  // Multi-account support for Codex OAuth
  export const CodexAccountRateLimit = z.object({
    limited: z.boolean(),
    resetAt: z.number().optional(),
    lastError: z.string().optional(),
  })

  export const CodexAccount = z.object({
    id: z.string(),
    email: z.string(),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
    rateLimit: CodexAccountRateLimit.optional(),
  })
  export type CodexAccount = z.infer<typeof CodexAccount>

  export const CodexMultiAccount = z
    .object({
      type: z.literal("codex-multi"),
      accounts: z.array(CodexAccount),
      activeIndex: z.number().default(0),
    })
    .meta({ ref: "CodexMultiAccount" })
  export type CodexMultiAccount = z.infer<typeof CodexMultiAccount>

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown, CodexMultiAccount]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  async function readRaw(): Promise<Record<string, unknown>> {
    const file = Bun.file(filepath)
    return file.json().catch(() => ({}) as Record<string, unknown>)
  }

  async function writeRaw(data: Record<string, unknown>): Promise<void> {
    const file = Bun.file(filepath)
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    const data = await readRaw()
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
    const data = await readRaw()
    data[key] = info
    await writeRaw(data)
  }

  export async function remove(key: string) {
    const data = await readRaw()
    delete data[key]
    await writeRaw(data)
  }

  // ===== Codex Multi-Account Methods =====

  export async function getCodexAuth(): Promise<CodexMultiAccount | undefined> {
    const { auth } = await readCodexAuthAndData()
    return auth
  }

  async function normalizeCodexAuth(
    auth: CodexMultiAccount,
    data?: Record<string, unknown>,
  ): Promise<CodexMultiAccount> {
    let mutated = false
    const now = Date.now()

    if (auth.accounts.length === 0) {
      if (auth.activeIndex !== 0) {
        auth.activeIndex = 0
        mutated = true
      }
    } else {
      const clamped = Math.max(0, Math.min(auth.activeIndex, auth.accounts.length - 1))
      if (clamped !== auth.activeIndex) {
        auth.activeIndex = clamped
        mutated = true
      }
    }

    for (const account of auth.accounts) {
      if (account.rateLimit?.limited && account.rateLimit.resetAt && account.rateLimit.resetAt <= now) {
        account.rateLimit = undefined
        mutated = true
      }
    }

    if (mutated) {
      const next = data ?? (await readRaw())
      next["codex"] = auth
      await writeRaw(next)
    }

    return auth
  }

  async function migrateCodexAuth(
    legacy: z.infer<typeof Oauth>,
    data: Record<string, unknown>,
    sourceKey?: "codex" | "openai",
  ): Promise<CodexMultiAccount> {
    const migrated: CodexMultiAccount = {
      type: "codex-multi",
      accounts: [
        {
          id: crypto.randomUUID(),
          email: legacy.accountId || "account-1",
          refresh: legacy.refresh,
          access: legacy.access,
          expires: legacy.expires,
          accountId: legacy.accountId,
        },
      ],
      activeIndex: 0,
    }
    data["codex"] = migrated
    if (sourceKey && sourceKey !== "codex") delete data[sourceKey]
    await writeRaw(data)
    return migrated
  }

  async function readCodexAuthAndData(): Promise<{ data: Record<string, unknown>; auth?: CodexMultiAccount }> {
    const data = await readRaw()
    const codex = data["codex"]
    if (codex) {
      const parsed = CodexMultiAccount.safeParse(codex)
      if (parsed.success) {
        const auth = await normalizeCodexAuth(parsed.data, data)
        return { data, auth }
      }

      // Check for legacy single-account format and migrate
      const legacy = Oauth.safeParse(codex)
      if (legacy.success) {
        const auth = await migrateCodexAuth(legacy.data, data, "codex")
        return { data, auth }
      }

      return { data }
    }

    // Migrate legacy OpenAI OAuth (single account) into Codex multi-account
    const legacyOpenAI = Oauth.safeParse(data["openai"])
    if (legacyOpenAI.success) {
      const auth = await migrateCodexAuth(legacyOpenAI.data, data, "openai")
      return { data, auth }
    }

    return { data }
  }

  export async function getCodexAccounts(): Promise<CodexAccount[]> {
    const auth = await getCodexAuth()
    return auth?.accounts ?? []
  }

  export async function getActiveCodexAccount(): Promise<CodexAccount | undefined> {
    const auth = await getCodexAuth()
    if (!auth || auth.accounts.length === 0) return undefined
    const index = Math.min(Math.max(auth.activeIndex, 0), auth.accounts.length - 1)
    return auth.accounts[index]
  }

  export async function setCodexAccount(account: Omit<CodexAccount, "id" | "rateLimit"> & { id?: string }): Promise<void> {
    const { data, auth: existing } = await readCodexAuthAndData()
    const auth = existing ?? { type: "codex-multi", accounts: [], activeIndex: 0 }

    // Check for existing account with same email or accountId (update instead of duplicate)
    const existingIndex = auth.accounts.findIndex(
      (a) => a.email === account.email || (!!account.accountId && a.accountId === account.accountId),
    )
    const newAccount: CodexAccount = {
      id: account.id || crypto.randomUUID(),
      email: account.email,
      refresh: account.refresh,
      access: account.access,
      expires: account.expires,
      accountId: account.accountId,
    }

    if (existingIndex >= 0) {
      // Update existing account tokens
      auth.accounts[existingIndex] = { ...auth.accounts[existingIndex], ...newAccount, id: auth.accounts[existingIndex].id }
      auth.activeIndex = existingIndex
    } else {
      // Add new account
      auth.accounts.push(newAccount)
      auth.activeIndex = auth.accounts.length - 1
    }

    data["codex"] = auth
    await writeRaw(data)
  }

  export async function removeCodexAccount(id: string): Promise<void> {
    const { data, auth } = await readCodexAuthAndData()
    if (!auth) return

    const index = auth.accounts.findIndex((a) => a.id === id)
    if (index < 0) return

    auth.accounts.splice(index, 1)

    // Adjust activeIndex if needed
    if (auth.accounts.length === 0) {
      auth.activeIndex = 0
    } else if (auth.activeIndex >= auth.accounts.length) {
      auth.activeIndex = auth.accounts.length - 1
    } else if (index < auth.activeIndex) {
      auth.activeIndex--
    }

    if (auth.accounts.length === 0) {
      delete data["codex"]
    } else {
      data["codex"] = auth
    }
    await writeRaw(data)
  }

  export async function setActiveCodexIndex(index: number): Promise<void> {
    const { data, auth } = await readCodexAuthAndData()
    if (!auth || auth.accounts.length === 0) return

    auth.activeIndex = Math.max(0, Math.min(index, auth.accounts.length - 1))
    data["codex"] = auth
    await writeRaw(data)
  }

  export async function markCodexAccountRateLimited(id: string, resetAt?: number): Promise<void> {
    const { data, auth } = await readCodexAuthAndData()
    if (!auth) return

    const account = auth.accounts.find((a) => a.id === id)
    if (!account) return

    account.rateLimit = {
      limited: true,
      resetAt: resetAt ?? Date.now() + 5 * 60 * 60 * 1000, // default 5 hours
    }

    data["codex"] = auth
    await writeRaw(data)
  }

  export async function clearCodexAccountRateLimit(id: string): Promise<void> {
    const { data, auth } = await readCodexAuthAndData()
    if (!auth) return

    const account = auth.accounts.find((a) => a.id === id)
    if (!account) return

    account.rateLimit = undefined
    data["codex"] = auth
    await writeRaw(data)
  }

  export async function getNextAvailableCodexAccount(): Promise<{ account: CodexAccount; index: number } | undefined> {
    const { data, auth } = await readCodexAuthAndData()
    if (!auth || auth.accounts.length === 0) return undefined

    const now = Date.now()
    let mutated = false

    // Clear expired rate limits
    for (const account of auth.accounts) {
      if (account.rateLimit?.limited && account.rateLimit.resetAt && account.rateLimit.resetAt <= now) {
        account.rateLimit = undefined
        mutated = true
      }
    }

    // Find first available account (not rate limited)
    for (let i = 0; i < auth.accounts.length; i++) {
      const account = auth.accounts[i]
      if (!account.rateLimit?.limited) {
        if (i !== auth.activeIndex) {
          auth.activeIndex = i
          mutated = true
        }
        if (mutated) {
          data["codex"] = auth
          await writeRaw(data)
        }
        return { account, index: i }
      }
    }

    if (mutated) {
      data["codex"] = auth
      await writeRaw(data)
    }

    return undefined
  }

  export async function updateCodexAccountTokens(
    id: string,
    tokens: { access: string; refresh: string; expires: number; accountId?: string },
  ): Promise<void> {
    const { data, auth } = await readCodexAuthAndData()

    if (!auth) {
      const legacy = Oauth.safeParse(data["openai"])
      if (!legacy.success) return
      data["openai"] = {
        ...legacy.data,
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
        ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
      }
      await writeRaw(data)
      return
    }

    const account =
      auth.accounts.find((a) => a.id === id) ?? (id === "legacy" && auth.accounts.length === 1 ? auth.accounts[0] : undefined)
    if (!account) return

    account.access = tokens.access
    account.refresh = tokens.refresh
    account.expires = tokens.expires
    if (tokens.accountId) account.accountId = tokens.accountId

    data["codex"] = auth
    await writeRaw(data)
  }
}
