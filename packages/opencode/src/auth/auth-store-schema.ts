import z from "zod"
import { ulid } from "ulid"

export const Health = z
  .object({
    cooldownUntil: z.number().optional(),
    lastStatusCode: z.number().optional(),
    lastErrorAt: z.number().optional(),
    successCount: z.number().default(0),
    failureCount: z.number().default(0),
  })
  .strict()
  .default(() => ({ successCount: 0, failureCount: 0 }))
export type Health = z.infer<typeof Health>

export const OAuthRecord = z
  .object({
    id: z.string(),
    namespace: z.string().default("default"),
    label: z.string().optional(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    health: Health,
  })
  .strict()
export type OAuthRecord = z.infer<typeof OAuthRecord>

export type OAuthRecordMeta = Omit<OAuthRecord, "refresh" | "access" | "expires">

export const OAuthProvider = z
  .object({
    type: z.literal("oauth"),
    active: z.record(z.string(), z.string()).default({}),
    order: z.record(z.string(), z.array(z.string())).default({}),
    records: z.array(OAuthRecord).default([]),
  })
  .strict()
export type OAuthProvider = z.infer<typeof OAuthProvider>

const ApiProvider = z
  .object({ type: z.literal("api"), key: z.string(), metadata: z.record(z.string(), z.string()).optional() })
  .strict()

const WellKnownProvider = z
  .object({ type: z.literal("wellknown"), key: z.string(), token: z.string() })
  .strict()

export const ProviderEntry = z.union([OAuthProvider, ApiProvider, WellKnownProvider])
export type ProviderEntry = z.infer<typeof ProviderEntry>

export const StoreFile = z
  .object({ version: z.literal(2), providers: z.record(z.string(), ProviderEntry).default({}) })
  .strict()
export type StoreFile = z.infer<typeof StoreFile>

// v1 legacy format (flat record, no multi-account)
const LegacyOauth = z.object({
  type: z.literal("oauth"),
  refresh: z.string(),
  access: z.string(),
  expires: z.number(),
  accountId: z.string().optional(),
  enterpriseUrl: z.string().optional(),
})
const LegacyApi = z.object({
  type: z.literal("api"),
  key: z.string(),
  metadata: z.record(z.string(), z.string()).optional(),
})
const LegacyWellKnown = z.object({ type: z.literal("wellknown"), key: z.string(), token: z.string() })
export const LegacyInfo = z.discriminatedUnion("type", [LegacyOauth, LegacyApi, LegacyWellKnown])

export type StoreUpdateResult<T> = { value: T; changed: boolean }

export function toMeta(record: OAuthRecord): OAuthRecordMeta {
  const { refresh: _r, access: _a, expires: _e, ...meta } = record
  return meta
}

export function ensureOAuthProvider(store: StoreFile, providerID: string): OAuthProvider {
  const existing = store.providers[providerID]
  if (existing && existing.type === "oauth") return existing
  const next: OAuthProvider = { type: "oauth", active: {}, order: {}, records: [] }
  store.providers[providerID] = next
  return next
}

export function findOAuthRecord(provider: OAuthProvider, recordID: string): OAuthRecord | undefined {
  return provider.records.find((r) => r.id === recordID)
}

export function normalizeOrder(ids: string[], order: string[]): string[] {
  const ordered: string[] = []
  for (const id of order) {
    if (ids.includes(id) && !ordered.includes(id)) ordered.push(id)
  }
  for (const id of ids) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  return ordered
}

export function recordIDsForNamespace(provider: OAuthProvider, namespace: string): string[] {
  const ids = provider.records.filter((r) => r.namespace === namespace).map((r) => r.id)
  return normalizeOrder(ids, provider.order[namespace] ?? [])
}

export async function findOAuthRecordIDByRefreshToken(input: {
  providerID: string
  namespace: string
  refresh: string
  provider: OAuthProvider
}): Promise<string | undefined> {
  for (const record of input.provider.records) {
    if (record.namespace === input.namespace && record.refresh === input.refresh) return record.id
  }
  return undefined
}

export function generateRecordID(): string {
  return ulid()
}
