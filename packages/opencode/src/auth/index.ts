import z from "zod"
import { CredentialStore, CredentialsMigrate } from "@/credentials"

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

  async function ensureMigrated() {
    await CredentialsMigrate.migrateIfNeeded()
  }

  export async function get(providerID: string) {
    await ensureMigrated()
    const matches = await CredentialStore.findByProvider(providerID, "default")
    if (matches.length === 0) return undefined

    // Compatibility behavior: prefer singleton "default" records, then newest.
    const preferred = matches.find((r) => (r.meta.label ?? "") === "default")
    const record = preferred ?? matches.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)[0]!
    const secret = await CredentialStore.decryptSecret(record)

    if (record.meta.kind === "api" && "apiKey" in secret) {
      return { type: "api", key: secret.apiKey }
    }
    if (record.meta.kind === "wellknown" && "envKey" in secret && "token" in secret) {
      return { type: "wellknown", key: secret.envKey, token: secret.token }
    }
    if (record.meta.kind === "oauth" && "accessToken" in secret) {
      return {
        type: "oauth",
        access: secret.accessToken,
        refresh: secret.refreshToken ?? "",
        expires: secret.expiresAt ?? 0,
        ...(secret.extra && typeof secret.extra === "object" && "enterpriseUrl" in secret.extra
          ? { enterpriseUrl: String((secret.extra as any).enterpriseUrl) }
          : undefined),
      }
    }

    return undefined
  }

  export async function all(): Promise<Record<string, Info>> {
    await ensureMigrated()
    const { records } = await CredentialStore.listAll()
    const providers = new Set(records.map((r) => r.meta.providerId))

    const result: Record<string, Info> = {}
    for (const providerId of providers) {
      const info = await get(providerId)
      if (!info) continue
      const parsed = Info.safeParse(info)
      if (!parsed.success) continue
      result[providerId] = parsed.data
    }

    return result
  }

  export async function set(key: string, info: Info) {
    await ensureMigrated()
    if (info.type === "api") {
      await CredentialStore.upsertSingleton({
        providerId: key,
        namespace: "default",
        kind: "api",
        label: "default",
        secret: { apiKey: info.key },
      })
      return
    }

    if (info.type === "wellknown") {
      await CredentialStore.upsertSingleton({
        providerId: key,
        namespace: "default",
        kind: "wellknown",
        label: "default",
        secret: { envKey: info.key, token: info.token },
      })
      return
    }

    if (info.type === "oauth") {
      await CredentialStore.upsertSingleton({
        providerId: key,
        namespace: "default",
        kind: "oauth",
        label: "default",
        secret: {
          accessToken: info.access,
          refreshToken: info.refresh,
          expiresAt: info.expires,
          extra: info.enterpriseUrl ? { enterpriseUrl: info.enterpriseUrl } : undefined,
        },
      })
      return
    }
  }

  export async function remove(key: string) {
    await ensureMigrated()
    const matches = await CredentialStore.findByProvider(key, "default")
    await Promise.all(matches.map((r) => CredentialStore.remove(r.meta.id)))
  }
}
