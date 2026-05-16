import { ulid } from "ulid"
import { Context, Effect, Layer, Schema } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { getOAuthRecordID } from "./context"
import {
  loadStoreFile,
  updateStore,
  ensureOAuthProvider,
  findOAuthRecord,
  findOAuthRecordIDByRefreshToken,
  recordIDsForNamespace,
  type OAuthRecordMeta,
} from "./store"
import { OAuthPool } from "./oauth-pool"

export { OAuthPool }
export type { OAuthRecordMeta }

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export async function get(providerID: string): Promise<Info | undefined> {
  const store = await loadStoreFile()
  const entry = store.providers[providerID]
  if (!entry) return undefined

  if (entry.type === "api") return { type: "api", key: entry.key, metadata: entry.metadata }
  if (entry.type === "wellknown") return { type: "wellknown", key: entry.key, token: entry.token }

  const namespace = "default"
  const contextID = getOAuthRecordID(providerID)
  const active = contextID ?? entry.active[namespace]
  const ordered = recordIDsForNamespace(entry, namespace)
  const recordID = active && ordered.includes(active) ? active : ordered[0]
  if (!recordID) return undefined

  const record = findOAuthRecord(entry, recordID)
  if (!record) return undefined
  return {
    type: "oauth",
    refresh: record.refresh,
    access: record.access,
    expires: record.expires,
    accountId: record.accountId,
    enterpriseUrl: record.enterpriseUrl,
  }
}

export async function all(): Promise<Record<string, Info>> {
  // Subprocess path: workspace.ts injects credentials via env for containerized scenarios
  if (process.env.OPENCODE_AUTH_CONTENT) {
    try {
      return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
    } catch {}
  }

  const store = await loadStoreFile()
  const out: Record<string, Info> = {}
  for (const providerID of Object.keys(store.providers)) {
    const info = await get(providerID)
    if (!info) continue
    out[providerID] = info
  }
  return out
}

export async function set(key: string, info: Info): Promise<void> {
  const normalized = key.replace(/\/+$/, "")
  return updateStore(async (store) => {
    if (normalized !== key) delete store.providers[key]
    const stale = `${normalized}/`
    if (store.providers[stale]) delete store.providers[stale]

    if (info.type === "api") {
      store.providers[normalized] = { type: "api", key: info.key, metadata: info.metadata }
      return { value: undefined, changed: true }
    }

    if (info.type === "wellknown") {
      store.providers[normalized] = { type: "wellknown", key: info.key, token: info.token }
      return { value: undefined, changed: true }
    }

    const namespace = "default"
    const provider = ensureOAuthProvider(store, normalized)
    const contextRecordID = getOAuthRecordID(normalized)
    const existingRecordID = await findOAuthRecordIDByRefreshToken({
      providerID: normalized,
      namespace,
      refresh: info.refresh,
      provider,
    })
    const recordID = contextRecordID ?? existingRecordID ?? ulid()
    const now = Date.now()
    const existing = findOAuthRecord(provider, recordID)

    if (!existing) {
      const existingCount = provider.records.filter((r) => r.namespace === namespace).length
      const label = existingCount === 0 ? "default" : `Account ${existingCount + 1}`
      provider.records.push({
        id: recordID,
        namespace,
        label,
        accountId: info.accountId,
        enterpriseUrl: info.enterpriseUrl,
        refresh: info.refresh,
        access: info.access,
        expires: info.expires,
        createdAt: now,
        updatedAt: now,
        health: { successCount: 0, failureCount: 0 },
      })
      provider.order[namespace] = [...(provider.order[namespace] ?? []), recordID]
    } else {
      existing.refresh = info.refresh
      existing.access = info.access
      existing.expires = info.expires
      existing.updatedAt = now
      if (info.accountId !== undefined) existing.accountId = info.accountId
      if (info.enterpriseUrl !== undefined) existing.enterpriseUrl = info.enterpriseUrl
      const order = provider.order[namespace] ?? []
      if (!order.includes(recordID)) provider.order[namespace] = [...order, recordID]
    }
    provider.active[namespace] = recordID
    return { value: undefined, changed: true }
  })
}

export async function remove(key: string): Promise<void> {
  const normalized = key.replace(/\/+$/, "")
  return updateStore((store) => {
    let changed = false
    if (store.providers[normalized]) { delete store.providers[normalized]; changed = true }
    const stale = `${normalized}/`
    if (store.providers[stale]) { delete store.providers[stale]; changed = true }
    return { value: undefined, changed }
  })
}

export async function addOAuth(
  providerID: string,
  input: Omit<Oauth, "type"> & { namespace?: string; label?: string },
): Promise<{ providerID: string; namespace: string; recordID: string }> {
  const namespace = (input.namespace ?? "default").trim() || "default"
  return updateStore(async (store) => {
    const provider = ensureOAuthProvider(store, providerID)
    const now = Date.now()
    const existingRecordID = await findOAuthRecordIDByRefreshToken({
      providerID,
      namespace,
      refresh: input.refresh,
      provider,
    })

    if (existingRecordID) {
      const existing = findOAuthRecord(provider, existingRecordID)
      if (existing) {
        existing.refresh = input.refresh
        existing.access = input.access
        existing.expires = input.expires
        existing.updatedAt = now
        if (input.accountId !== undefined) existing.accountId = input.accountId
        if (input.enterpriseUrl !== undefined) existing.enterpriseUrl = input.enterpriseUrl
        if (input.label) existing.label = input.label
      }
      const order = provider.order[namespace] ?? []
      if (!order.includes(existingRecordID)) provider.order[namespace] = [...order, existingRecordID]
      provider.active[namespace] = existingRecordID
      return { value: { providerID, namespace, recordID: existingRecordID }, changed: true }
    }

    const recordID = ulid()
    const existingCount = provider.records.filter((r) => r.namespace === namespace).length
    const autoLabel = existingCount === 0 ? "default" : `Account ${existingCount + 1}`

    provider.records.push({
      id: recordID,
      namespace,
      label: input.label ?? autoLabel,
      accountId: input.accountId,
      enterpriseUrl: input.enterpriseUrl,
      refresh: input.refresh,
      access: input.access,
      expires: input.expires,
      createdAt: now,
      updatedAt: now,
      health: { successCount: 0, failureCount: 0 },
    })
    provider.order[namespace] = [...(provider.order[namespace] ?? []), recordID]
    provider.active[namespace] = recordID
    return { value: { providerID, namespace, recordID }, changed: true }
  })
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() =>
    Service.of({
      get: (providerID) =>
        Effect.tryPromise({ try: () => get(providerID), catch: fail("Failed to read auth data") }),
      all: () =>
        Effect.tryPromise({ try: () => all(), catch: fail("Failed to read auth data") }),
      set: (key, info) =>
        Effect.tryPromise({ try: () => set(key, info), catch: fail("Failed to write auth data") }),
      remove: (key) =>
        Effect.tryPromise({ try: () => remove(key), catch: fail("Failed to write auth data") }),
    }),
  ),
)

export const defaultLayer = layer

export * as Auth from "."
