import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "@/global"
import { VaultFS } from "@/vault/fs"
import { CredentialStore } from "./store"

const LegacyAuthOauth = z.object({
  type: z.literal("oauth"),
  refresh: z.string(),
  access: z.string(),
  expires: z.number(),
  enterpriseUrl: z.string().optional(),
})

const LegacyAuthApi = z.object({
  type: z.literal("api"),
  key: z.string(),
})

const LegacyAuthWellKnown = z.object({
  type: z.literal("wellknown"),
  key: z.string(),
  token: z.string(),
})

const LegacyAuthInfo = z.discriminatedUnion("type", [LegacyAuthOauth, LegacyAuthApi, LegacyAuthWellKnown])

const LegacyMcpAuthEntry = z
  .object({
    tokens: z
      .object({
        accessToken: z.string(),
        refreshToken: z.string().optional(),
        expiresAt: z.number().optional(),
        scope: z.string().optional(),
      })
      .optional(),
    clientInfo: z
      .object({
        clientId: z.string(),
        clientSecret: z.string().optional(),
        clientIdIssuedAt: z.number().optional(),
        clientSecretExpiresAt: z.number().optional(),
      })
      .optional(),
    codeVerifier: z.string().optional(),
  })
  .strict()

export namespace CredentialsMigrate {
  const LEGACY_AUTH_PATH = path.join(Global.Path.data, "auth.json")
  const LEGACY_MCP_AUTH_PATH = path.join(Global.Path.data, "mcp-auth.json")
  let didRun = false
  let inFlight: Promise<void> | undefined

  export async function migrateIfNeeded(): Promise<void> {
    if (didRun) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      const hasAny = await CredentialStore.hasAnyRecords()
      if (hasAny) return

      await migrateLegacyAuth()
      await migrateLegacyMcpAuth()
    })()
    try {
      await inFlight
      didRun = true
    } finally {
      inFlight = undefined
    }
  }

  async function migrateLegacyAuth() {
    const legacy = await VaultFS.readJson<Record<string, unknown>>(LEGACY_AUTH_PATH)
    if (!legacy) return

    for (const [providerId, raw] of Object.entries(legacy)) {
      const parsed = LegacyAuthInfo.safeParse(raw)
      if (!parsed.success) continue

      const info = parsed.data
      if (info.type === "api") {
        await CredentialStore.upsertSingleton({
          providerId,
          namespace: "default",
          kind: "api",
          label: "default",
          secret: { apiKey: info.key },
        })
      } else if (info.type === "oauth") {
        await CredentialStore.put({
          providerId,
          namespace: "default",
          kind: "oauth",
          label: `migrated-${providerId}`,
          secret: {
            accessToken: info.access,
            refreshToken: info.refresh,
            expiresAt: info.expires,
            extra: info.enterpriseUrl ? { enterpriseUrl: info.enterpriseUrl } : undefined,
          },
        })
      } else if (info.type === "wellknown") {
        await CredentialStore.upsertSingleton({
          providerId,
          namespace: "default",
          kind: "wellknown",
          label: "default",
          secret: { envKey: info.key, token: info.token },
        })
      }
    }

    const bak = path.join(Global.Path.data, "auth.v1.json.bak")
    await fs.rename(LEGACY_AUTH_PATH, bak).catch(() => {})
  }

  async function migrateLegacyMcpAuth() {
    const legacy = await VaultFS.readJson<Record<string, unknown>>(LEGACY_MCP_AUTH_PATH)
    if (!legacy) return

    for (const [mcpName, raw] of Object.entries(legacy)) {
      const parsed = LegacyMcpAuthEntry.safeParse(raw)
      if (!parsed.success) continue

      await CredentialStore.upsertSingleton({
        providerId: `mcp:${mcpName}`,
        namespace: "default",
        kind: "mcp",
        label: mcpName,
        secret: { entry: parsed.data },
      })
    }

    const bak = path.join(Global.Path.data, "mcp-auth.v1.json.bak")
    await fs.rename(LEGACY_MCP_AUTH_PATH, bak).catch(() => {})
  }
}
