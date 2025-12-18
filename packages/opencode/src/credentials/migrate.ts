import path from "path"
import crypto from "crypto"
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
  const MIGRATIONS_PATH = path.join(Global.Path.data, "credentials", "migrations.json")
  let didRun = false
  let inFlight: Promise<void> | undefined

  const MigrationState = z
    .object({
      version: z.literal(1),
      legacyAuth: z.record(z.string(), z.string()).default({}),
      legacyMcpAuth: z.record(z.string(), z.string()).default({}),
    })
    .strict()
  type MigrationState = z.infer<typeof MigrationState>

  function fingerprint(raw: unknown): string {
    const json = JSON.stringify(raw) ?? ""
    return crypto.createHash("sha256").update(json).digest("hex")
  }

  async function loadState(): Promise<MigrationState> {
    const json = await VaultFS.readJson<unknown>(MIGRATIONS_PATH)
    const parsed = MigrationState.safeParse(json)
    if (parsed.success) return parsed.data
    return { version: 1, legacyAuth: {}, legacyMcpAuth: {} }
  }

  async function saveState(state: MigrationState): Promise<void> {
    await VaultFS.atomicWriteJson(MIGRATIONS_PATH, state, 0o600)
  }

  export async function migrateIfNeeded(): Promise<void> {
    if (didRun) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      const state = await loadState()
      const changed = (await migrateLegacyAuth(state)) || (await migrateLegacyMcpAuth(state))
      if (changed) {
        await saveState(state)
      }
    })()
    try {
      await inFlight
      didRun = true
    } finally {
      inFlight = undefined
    }
  }

  async function migrateLegacyAuth(state: MigrationState): Promise<boolean> {
    const legacy = await VaultFS.readJson<Record<string, unknown>>(LEGACY_AUTH_PATH)
    if (!legacy) return false
    let changed = false

    for (const [providerId, raw] of Object.entries(legacy)) {
      const parsed = LegacyAuthInfo.safeParse(raw)
      if (!parsed.success) continue

      const info = parsed.data
      const sig = fingerprint(raw)
      if (state.legacyAuth[providerId] === sig) continue

      if (info.type === "api") {
        await CredentialStore.upsertSingleton({
          providerId,
          namespace: "default",
          kind: "api",
          label: "default",
          secret: { apiKey: info.key },
        })
      } else if (info.type === "oauth") {
        await CredentialStore.upsertSingleton({
          providerId,
          namespace: "default",
          kind: "oauth",
          label: "migrated",
          secret: {
            accessToken: info.access,
            refreshToken: info.refresh || undefined,
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

      state.legacyAuth[providerId] = sig
      changed = true
    }
    return changed
  }

  async function migrateLegacyMcpAuth(state: MigrationState): Promise<boolean> {
    const legacy = await VaultFS.readJson<Record<string, unknown>>(LEGACY_MCP_AUTH_PATH)
    if (!legacy) return false
    let changed = false

    for (const [mcpName, raw] of Object.entries(legacy)) {
      const parsed = LegacyMcpAuthEntry.safeParse(raw)
      if (!parsed.success) continue

      const sig = fingerprint(raw)
      if (state.legacyMcpAuth[mcpName] === sig) continue

      await CredentialStore.upsertSingleton({
        providerId: `mcp:${mcpName}`,
        namespace: "default",
        kind: "mcp",
        label: mcpName,
        secret: { entry: parsed.data },
      })

      state.legacyMcpAuth[mcpName] = sig
      changed = true
    }
    return changed
  }
}
