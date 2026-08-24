import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Global } from "@opencode-ai/core/global"
import { Effect, Layer, Context, Option, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Keychain } from "./keychain"

export const Tokens = Schema.Struct({
  accessToken: Schema.mutableKey(Schema.String),
  refreshToken: Schema.mutableKey(Schema.optional(Schema.String)),
  expiresAt: Schema.mutableKey(Schema.optional(Schema.Number)),
  scope: Schema.mutableKey(Schema.optional(Schema.String)),
})
export type Tokens = Schema.Schema.Type<typeof Tokens>

export const ClientInfo = Schema.Struct({
  clientId: Schema.mutableKey(Schema.String),
  clientSecret: Schema.mutableKey(Schema.optional(Schema.String)),
  clientIdIssuedAt: Schema.mutableKey(Schema.optional(Schema.Number)),
  clientSecretExpiresAt: Schema.mutableKey(Schema.optional(Schema.Number)),
})
export type ClientInfo = Schema.Schema.Type<typeof ClientInfo>

export const Entry = Schema.Struct({
  tokens: Schema.mutableKey(Schema.optional(Tokens)),
  clientInfo: Schema.mutableKey(Schema.optional(ClientInfo)),
  codeVerifier: Schema.mutableKey(Schema.optional(Schema.String)),
  oauthState: Schema.mutableKey(Schema.optional(Schema.String)),
  serverUrl: Schema.mutableKey(Schema.optional(Schema.String)),
})
export type Entry = Schema.Schema.Type<typeof Entry>

const decodeAuthData = Schema.decodeUnknownOption(Schema.Record(Schema.String, Entry))
type AuthData = Record<string, Entry>

const filepath = path.join(Global.Path.data, "mcp-auth.json")
const lockKey = `mcp-auth:${filepath}`

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, Entry>>
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly set: (mcpName: string, entry: Entry, serverUrl?: string) => Effect.Effect<void>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateTokens: (mcpName: string, tokens: Tokens, serverUrl?: string) => Effect.Effect<void>
  readonly updateClientInfo: (mcpName: string, clientInfo: ClientInfo, serverUrl?: string) => Effect.Effect<void>
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpAuth") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const flock = yield* EffectFlock.Service

    // Secrets (tokens, client secrets) live in the OS keychain when available; the file keeps only
    // non-secret metadata as an enumeration index. Legacy file entries with embedded secrets remain
    // readable and migrate into the keychain on their next save. Locking note: the locked wrappers
    // below must only call unlocked cores — the file lock is not reentrant.
    const read = Effect.fn("McpAuth.read")(function* () {
      return yield* fs.readJson(filepath).pipe(
        Effect.map((data): AuthData => Option.getOrElse(decodeAuthData(data), () => ({}) as AuthData) as AuthData),
        Effect.catch(() => Effect.succeed({} as AuthData)),
      )
    })

    const keychainName = (mcpName: string) => mcpName.replace(/\s+/g, "_")

    const keychainGet = Effect.fn("McpAuth.keychainGet")(function* (mcpName: string) {
      if (!(yield* Keychain.available())) return undefined
      const value = yield* Keychain.get(keychainName(mcpName))
      if (value === undefined) return undefined
      return Option.getOrElse(decodeAuthData({ [mcpName]: value }), () => ({}) as AuthData)[mcpName]
    })

    const readFileData = Effect.fn("McpAuth.readFileData")(function* () {
      return yield* read()
    })

    const writeFileData = Effect.fn("McpAuth.writeFileData")(function* (update: (data: AuthData) => AuthData) {
      const next = update(yield* read())
      yield* fs.writeJson(filepath, next, 0o600).pipe(Effect.orDie)
    })

    const persistUnlocked = Effect.fn("McpAuth.persistUnlocked")(function* (
      mcpName: string,
      entry: Entry | undefined,
    ) {
      if (!entry) {
        if (yield* Keychain.available()) yield* Keychain.remove(keychainName(mcpName))
        yield* writeFileData((data) => {
          const next = { ...data }
          delete next[mcpName]
          return next
        })
        return
      }
      const { tokens, clientInfo, ...metadata } = entry
      if (yield* Keychain.available()) {
        const stored = yield* Keychain.set(keychainName(mcpName), { tokens, clientInfo })
        // Only strip secrets from the file once the keychain round-trips; otherwise keep the
        // legacy plaintext entry rather than risking the credentials.
        if (stored) {
          yield* writeFileData((data) => ({ ...data, [mcpName]: metadata }))
          return
        }
      }
      yield* writeFileData((data) => ({ ...data, [mcpName]: entry }))
    })

    const readMerged = Effect.fn("McpAuth.readMerged")(function* () {
      const fileData = yield* readFileData()
      const merged: AuthData = {}
      for (const [name, entry] of Object.entries(fileData)) {
        const fromKeychain = yield* keychainGet(name).pipe(Effect.orElseSucceed(() => undefined))
        merged[name] = fromKeychain ?? entry
      }
      return merged
    })

    const all = Effect.fn("McpAuth.all")(function* () {
      return yield* readMerged().pipe(flock.withLock(lockKey), Effect.orDie)
    })

    const mutate = Effect.fn("McpAuth.mutate")(function* (update: (data: AuthData) => AuthData | undefined) {
      yield* Effect.gen(function* () {
        const current = yield* readMerged()
        // Snapshot before running update: update functions may mutate entries in place, which
        // would make a naive before/after diff compare the mutated object against itself.
        const before = new Map(Object.entries(current).map(([name, entry]) => [name, JSON.stringify(entry)]))
        const next = update(current)
        if (!next) return
        const names = new Set([...Object.keys(current), ...Object.keys(next)])
        for (const name of names) {
          const after = JSON.stringify(next[name] ?? {})
          if ((before.get(name) ?? "{}") === after) continue
          yield* persistUnlocked(name, next[name])
        }
      }).pipe(flock.withLock(lockKey), Effect.orDie)
    })

    const get = Effect.fn("McpAuth.get")(function* (mcpName: string) {
      const data = yield* all()
      return data[mcpName]
    })

    const getForUrl = Effect.fn("McpAuth.getForUrl")(function* (mcpName: string, serverUrl: string) {
      const entry = yield* get(mcpName)
      if (!entry) return undefined
      if (!entry.serverUrl) return undefined
      if (entry.serverUrl !== serverUrl) return undefined
      return entry
    })

    const set = Effect.fn("McpAuth.set")(function* (mcpName: string, entry: Entry, serverUrl?: string) {
      yield* mutate((data) => ({
        ...data,
        [mcpName]: serverUrl ? { ...entry, serverUrl } : entry,
      }))
    })

    const remove = Effect.fn("McpAuth.remove")(function* (mcpName: string) {
      yield* mutate((data) => {
        const next = { ...data }
        delete next[mcpName]
        return next
      })
    })

    const updateField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string, value: NonNullable<Entry[K]>, serverUrl?: string) {
        yield* mutate((data) => {
          const entry = data[mcpName] ?? {}
          entry[field] = value
          if (serverUrl) entry.serverUrl = serverUrl
          return { ...data, [mcpName]: entry }
        })
      })

    const clearField = (field: keyof Entry, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string) {
        yield* mutate((data) => {
          const entry = data[mcpName]
          if (!entry) return undefined
          delete entry[field]
          return { ...data, [mcpName]: entry }
        })
      })

    const updateTokens = updateField("tokens", "updateTokens")
    const updateClientInfo = updateField("clientInfo", "updateClientInfo")
    const updateCodeVerifier = updateField("codeVerifier", "updateCodeVerifier")
    const updateOAuthState = updateField("oauthState", "updateOAuthState")
    const clearCodeVerifier = clearField("codeVerifier", "clearCodeVerifier")
    const clearOAuthState = clearField("oauthState", "clearOAuthState")

    const getOAuthState = Effect.fn("McpAuth.getOAuthState")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      return entry?.oauthState
    })

    return Service.of({
      all,
      get,
      getForUrl,
      set,
      remove,
      updateTokens,
      updateClientInfo,
      updateCodeVerifier,
      clearCodeVerifier,
      updateOAuthState,
      getOAuthState,
      clearOAuthState,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, EffectFlock.node] })

export * as McpAuth from "./auth"
