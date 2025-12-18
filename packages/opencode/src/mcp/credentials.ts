import z from "zod"
import { CredentialStore, CredentialsMigrate } from "@/credentials"

export namespace McpCredentials {
  export const Tokens = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    scope: z.string().optional(),
  })
  export type Tokens = z.infer<typeof Tokens>

  export const ClientInfo = z.object({
    clientId: z.string(),
    clientSecret: z.string().optional(),
    clientIdIssuedAt: z.number().optional(),
    clientSecretExpiresAt: z.number().optional(),
  })
  export type ClientInfo = z.infer<typeof ClientInfo>

  export const Entry = z.object({
    tokens: Tokens.optional(),
    clientInfo: ClientInfo.optional(),
    codeVerifier: z.string().optional(),
    oauthState: z.string().optional(),
    serverUrl: z.string().optional(), // Track the URL these credentials are for
  })
  export type Entry = z.infer<typeof Entry>

  const KIND = "mcp" as const

  async function ensureMigrated() {
    await CredentialsMigrate.migrateIfNeeded()
  }

  function providerId(mcpName: string) {
    return `mcp:${mcpName}`
  }

  export async function get(mcpName: string): Promise<Entry | undefined> {
    await ensureMigrated()
    const matches = await CredentialStore.findByProvider(providerId(mcpName), "default")
    const record = matches.find((r) => r.meta.kind === KIND)
    if (!record) return undefined
    const secret = await CredentialStore.decryptSecret(record)
    if (!secret || typeof secret !== "object" || !("entry" in secret)) return undefined
    const parsed = Entry.safeParse((secret as any).entry)
    return parsed.success ? parsed.data : undefined
  }

  /**
   * Get auth entry and validate it's for the correct URL.
   * Returns undefined if URL has changed (credentials are invalid).
   */
  export async function getForUrl(mcpName: string, serverUrl: string): Promise<Entry | undefined> {
    const entry = await get(mcpName)
    if (!entry) return undefined

    // If no serverUrl is stored, this is from an old version - consider it invalid
    if (!entry.serverUrl) return undefined

    // If URL has changed, credentials are invalid
    if (entry.serverUrl !== serverUrl) return undefined

    return entry
  }

  export async function all(): Promise<Record<string, Entry>> {
    await ensureMigrated()
    const { records } = await CredentialStore.listAll()
    const result: Record<string, Entry> = {}
    for (const record of records) {
      if (record.meta.kind !== KIND) continue
      if (!record.meta.providerId.startsWith("mcp:")) continue
      const mcpName = record.meta.providerId.slice("mcp:".length)
      const entry = await get(mcpName)
      if (entry) result[mcpName] = entry
    }
    return result
  }

  export async function set(mcpName: string, entry: Entry, serverUrl?: string): Promise<void> {
    await ensureMigrated()
    if (serverUrl) {
      entry.serverUrl = serverUrl
    }
    await CredentialStore.upsertSingleton({
      providerId: providerId(mcpName),
      namespace: "default",
      kind: KIND,
      label: mcpName,
      secret: { entry },
    })
  }

  export async function remove(mcpName: string): Promise<void> {
    await ensureMigrated()
    const matches = await CredentialStore.findByProvider(providerId(mcpName), "default")
    await Promise.all(matches.filter((r) => r.meta.kind === KIND).map((r) => CredentialStore.remove(r.meta.id)))
  }

  export async function updateTokens(mcpName: string, tokens: Tokens, serverUrl?: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.tokens = tokens
    await set(mcpName, entry, serverUrl)
  }

  export async function updateClientInfo(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.clientInfo = clientInfo
    await set(mcpName, entry, serverUrl)
  }

  export async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.codeVerifier = codeVerifier
    await set(mcpName, entry)
  }

  export async function clearCodeVerifier(mcpName: string): Promise<void> {
    const entry = await get(mcpName)
    if (!entry) return
    delete entry.codeVerifier
    await set(mcpName, entry)
  }

  export async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.oauthState = oauthState
    await set(mcpName, entry)
  }

  export async function getOAuthState(mcpName: string): Promise<string | undefined> {
    const entry = await get(mcpName)
    return entry?.oauthState
  }

  export async function clearOAuthState(mcpName: string): Promise<void> {
    const entry = await get(mcpName)
    if (entry) {
      delete entry.oauthState
      await set(mcpName, entry)
    }
  }
}

