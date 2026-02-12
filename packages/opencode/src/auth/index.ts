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
      email: z.string().optional(), // For multi-account identification
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
      email: z.string().optional(), // For multi-account identification
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

  // Multi-account storage format
  export type AccountStore = {
    [provider: string]: {
      accounts: {
        [accountId: string]: Info & { disabled?: boolean }
      }
      // Current active account for this provider
      activeAccount?: string
    }
  }

  const filepath = path.join(Global.Path.data, "auth.json")

  /**
   * Get credential for a provider.
   * Uses activeAccount if set, otherwise returns first available.
   * Supports environment variable overrides:
   * - OPENCODE_ACCOUNT_<PROVIDER>: e.g., OPENCODE_ACCOUNT_OPENAI=work
   * - OPENCODE_ACCOUNT: general override for any provider
   */
  export async function get(providerID: string): Promise<Info | undefined> {
    const store = await load()
    const provider = store[providerID]
    
    if (!provider || !provider.accounts) return undefined
    
    // Check for environment variable overrides
    const envVarName = `OPENCODE_ACCOUNT_${providerID.toUpperCase()}`
    const envAccount = process.env[envVarName] || process.env["OPENCODE_ACCOUNT"]
    
    if (envAccount) {
      // Use the specific account from env var
      const account = provider.accounts[envAccount]
      if (account && !account.disabled) {
        return account
      }
      // If account not found or disabled, fall through to active account
    }
    
    // Use active account if set
    if (provider.activeAccount && provider.accounts[provider.activeAccount]) {
      return provider.accounts[provider.activeAccount]
    }
    
    // Otherwise, find first non-disabled account
    for (const [id, info] of Object.entries(provider.accounts)) {
      if (!info.disabled) return info
    }
    
    return undefined
  }

  /**
   * Get all accounts for a provider.
   */
  export async function getAccounts(providerID: string): Promise<Record<string, Info>> {
    const store = await load()
    const provider = store[providerID]
    return provider?.accounts ?? {}
  }

  /**
   * List all providers and their accounts.
   */
  export async function all(): Promise<AccountStore> {
    return await load()
  }

  /**
   * Add a new credential to a provider.
   * Automatically creates a new account entry.
   * Returns the account ID (email or generated).
   */
  export async function add(providerID: string, info: Info): Promise<string> {
    const store = await load()
    
    if (!store[providerID]) {
      store[providerID] = { accounts: {} }
    }
    
    // Generate account ID from email if available, otherwise use timestamp
    let accountId = "default"
    if ("email" in info && info.email) {
      accountId = info.email
    } else if ("refresh" in info && info.refresh) {
      // For OAuth, use a hash of refresh token
      accountId = `oauth-${Date.now()}`
    } else {
      accountId = `key-${Date.now()}`
    }
    
    store[providerID].accounts[accountId] = info
    
    // If this is the first account, set as active
    if (!store[providerID].activeAccount) {
      store[providerID].activeAccount = accountId
    }
    
    await save(store)
    return accountId
  }

  /**
   * Set credential (alias for add for compatibility)
   */
  export async function set(providerID: string, info: Info, account?: string) {
    // For backwards compatibility: if account is provided, use it
    if (account) {
      const store = await load()
      if (!store[providerID]) {
        store[providerID] = { accounts: {} }
      }
      store[providerID].accounts[account] = info
      if (!store[providerID].activeAccount) {
        store[providerID].activeAccount = account
      }
      await save(store)
    } else {
      // Otherwise add as new account
      await add(providerID, info)
    }
  }

  /**
   * Remove an account from a provider.
   * If account is "all" or not specified, removes all.
   */
  export async function remove(providerID: string, account?: string) {
    const store = await load()
    const provider = store[providerID]
    
    if (!provider) return
    
    if (!account) {
      // Remove all accounts for this provider
      delete store[providerID]
    } else if (account === "all") {
      delete store[providerID]
    } else {
      delete provider.accounts[account]
      
      // If we removed the active account, switch to another
      if (provider.activeAccount === account) {
        const remaining = Object.keys(provider.accounts)
        provider.activeAccount = remaining[0] ?? undefined
      }
    }
    
    await save(store)
  }

  /**
   * List all accounts for a provider.
   */
  export async function list(providerID: string): Promise<string[]> {
    const store = await load()
    const provider = store[providerID]
    return provider ? Object.keys(provider.accounts) : []
  }

  /**
   * Get active account for a provider.
   */
  export async function getActiveAccount(providerID: string): Promise<string | undefined> {
    const store = await load()
    return store[providerID]?.activeAccount
  }

  /**
   * Set active account for a provider.
   */
  export async function use(providerID: string, account: string) {
    const store = await load()
    const provider = store[providerID]
    
    if (!provider || !provider.accounts[account]) {
      throw new Error(`Account ${account} not found for provider ${providerID}`)
    }
    
    provider.activeAccount = account
    await save(store)
  }

  /**
   * Enable/disable an account (for rotation).
   */
  export async function setEnabled(providerID: string, account: string, enabled: boolean) {
    const store = await load()
    const provider = store[providerID]
    
    if (!provider || !provider.accounts[account]) return
    
    provider.accounts[account].disabled = !enabled
    
    // If we disabled the active account, switch to another
    if (!enabled && provider.activeAccount === account) {
      const remaining = Object.keys(provider.accounts).filter(a => !provider.accounts[a].disabled)
      provider.activeAccount = remaining[0] ?? undefined
    }
    
    await save(store)
  }

  /**
   * Get next available account (for auto-rotation on rate-limit).
   */
  export async function getNextAccount(providerID: string): Promise<{ account: string, info: Info } | undefined> {
    const store = await load()
    const provider = store[providerID]
    
    if (!provider || !provider.accounts) return undefined
    
    const accounts = Object.entries(provider.accounts).filter(([_, info]) => !info.disabled)
    
    if (accounts.length === 0) return undefined
    
    // Simple round-robin: switch to next account
    const currentActive = provider.activeAccount
    const currentIndex = accounts.findIndex(([id]) => id === currentActive)
    const nextIndex = (currentIndex + 1) % accounts.length
    
    const [account, info] = accounts[nextIndex]
    provider.activeAccount = account
    await save(store)
    
    return { account, info }
  }

  /**
   * Check if an error is a rate-limit error (429).
   */
  export function isRateLimitError(error: unknown): boolean {
    if (!error) return false
    
    const errorObj = error as any
    const status = errorObj?.status || errorObj?.statusCode
    
    if (status === 429) return true
    
    // Check for common rate-limit messages
    const message = errorObj?.message || String(error)
    const lowerMessage = message.toLowerCase()
    return lowerMessage.includes("rate limit") || 
           lowerMessage.includes("too many requests") ||
           lowerMessage.includes("rate_limit") ||
           lowerMessage.includes("429")
  }

  /**
   * Execute a function with automatic account rotation on rate-limit.
   * Returns the result if successful, or throws if all accounts are exhausted.
   */
  export async function withRetry<T>(
    providerID: string,
    fn: (info: Info) => Promise<T>,
    maxRetries?: number
  ): Promise<T> {
    const max = maxRetries ?? 10
    let lastError: unknown
    
    for (let i = 0; i < max; i++) {
      const info = await get(providerID)
      if (!info) {
        throw new Error(`No credentials found for provider ${providerID}`)
      }
      
      try {
        return await fn(info)
      } catch (error) {
        lastError = error
        
        if (!isRateLimitError(error)) {
          // Not a rate-limit error, throw immediately
          throw error
        }
        
        // Rate-limit error - try next account
        console.log(`[auth] Rate limited on ${providerID}, switching account...`)
        
        const next = await getNextAccount(providerID)
        if (!next) {
          throw new Error(`Rate limited and no more accounts available for ${providerID}`)
        }
      }
    }
    
    throw lastError
  }

  /**
   * Legacy compatibility: convert old format to new.
   */
  async function migrateIfNeeded(store: AccountStore): Promise<AccountStore> {
    // Check if it's in legacy format (direct Info objects instead of { accounts: {} })
    for (const [providerID, value] of Object.entries(store)) {
      if (value && typeof value === "object" && !("accounts" in value)) {
        // Legacy format - migrate
        const info = value as unknown as Info
        store[providerID] = {
          accounts: { default: info },
          activeAccount: "default"
        }
      }
    }
    return store
  }

  // Load auth data from file
  async function load(): Promise<AccountStore> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}))
    return await migrateIfNeeded(data)
  }

  // Save auth data to file
  async function save(store: AccountStore) {
    const file = Bun.file(filepath)
    await Bun.write(file, JSON.stringify(store, null, 2), { mode: 0o600 })
  }
}
