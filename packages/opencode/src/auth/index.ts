import path from "path"
import { Effect, Layer, Record, Result, Schema, Context, Semaphore } from "effect"
import { isDeepStrictEqual } from "node:util"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"
export const DEFAULT_ACCOUNT_KEY = "default"
export const ACCOUNT_KEY_SEPARATOR = "::"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

const normalizeKey = (key: string) => key.replace(/\/+$/, "")

type ParsedAuthKey = {
  providerID: string
  accountKey?: string
  storageKey: string
}

export function accountStorageKey(providerID: string, accountKey?: string) {
  const provider = normalizeKey(providerID)
  const normalizedAccountKey = accountKey?.trim()
  if (!normalizedAccountKey || normalizedAccountKey === DEFAULT_ACCOUNT_KEY) return provider
  return `${provider}${ACCOUNT_KEY_SEPARATOR}${normalizedAccountKey}`
}

export function parseAuthStorageKey(key: string): ParsedAuthKey {
  const normalized = normalizeKey(key)
  const split = normalized.indexOf(ACCOUNT_KEY_SEPARATOR)
  if (split <= 0) {
    return {
      providerID: normalized,
      storageKey: normalized,
    }
  }
  const providerID = normalizeKey(normalized.slice(0, split))
  const accountKey = normalized.slice(split + ACCOUNT_KEY_SEPARATOR.length).trim()
  if (!accountKey) {
    return {
      providerID: normalized,
      storageKey: normalized,
    }
  }
  return {
    providerID,
    accountKey,
    storageKey: accountStorageKey(providerID, accountKey),
  }
}

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  _accountLabel: Schema.optional(Schema.String),
  _accountEmail: Schema.optional(Schema.String),
  _accountId: Schema.optional(Schema.String),
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  _accountLabel: Schema.optional(Schema.String),
  _accountEmail: Schema.optional(Schema.String),
  _accountId: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
  _accountLabel: Schema.optional(Schema.String),
  _accountEmail: Schema.optional(Schema.String),
  _accountId: Schema.optional(Schema.String),
}) {}

const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export const Info = Object.assign(_Info, { zod: zod(_Info) })
export type Info = Schema.Schema.Type<typeof _Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly accounts: (providerID: string) => Effect.Effect<Record<string, Info>, AuthError>
  readonly active: (
    providerID: string,
  ) => Effect.Effect<{ accountKey: string; info: Info } | undefined, AuthError>
  readonly activate: (providerID: string, accountKey: string) => Effect.Effect<void, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Info)
    const writeLock = Semaphore.makeUnsafe(1)

    const all = Effect.fn("Auth.all")(function* () {
      let source: Record<string, unknown> | undefined
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          const parsed = JSON.parse(process.env.OPENCODE_AUTH_CONTENT) as unknown
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            source = parsed as Record<string, unknown>
          }
        } catch {}
      }

      if (source) {
        return Record.filterMap(source, (value) => Result.fromOption(decode(value), () => undefined))
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const accounts = Effect.fn("Auth.accounts")(function* (providerID: string) {
      const data = yield* all()
      const provider = normalizeKey(providerID)
      const grouped: Record<string, Info> = {}
      for (const [key, info] of Object.entries(data)) {
        const parsed = parseAuthStorageKey(key)
        if (parsed.providerID !== provider) continue
        grouped[parsed.accountKey ?? DEFAULT_ACCOUNT_KEY] = info
      }
      return grouped
    })

    const active = Effect.fn("Auth.active")(function* (providerID: string) {
      const list = yield* accounts(providerID)
      const current = list[DEFAULT_ACCOUNT_KEY]
      if (!current) return
      for (const [accountKey, info] of Object.entries(list)) {
        if (accountKey === DEFAULT_ACCOUNT_KEY) continue
        if (isDeepStrictEqual(info, current)) {
          return {
            accountKey,
            info: current,
          }
        }
      }
      return {
        accountKey: DEFAULT_ACCOUNT_KEY,
        info: current,
      }
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* active(providerID))?.info
    })

    const activate = Effect.fn("Auth.activate")(function* (providerID: string, accountKey: string) {
      yield* writeLock.withPermits(1)(
        Effect.gen(function* () {
          const data = yield* all()
          const provider = normalizeKey(providerID)
          const target = accountStorageKey(provider, accountKey)
          const selected = data[target]
          if (!selected) {
            return yield* Effect.fail(
              new AuthError({
                message: `Auth account not found for provider '${provider}' and account '${accountKey}'.`,
              }),
            )
          }
          data[provider] = selected
          yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
        }),
      )
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      yield* writeLock.withPermits(1)(
        Effect.gen(function* () {
          const norm = normalizeKey(key)
          const parsed = parseAuthStorageKey(norm)
          const data = yield* all()
          if (norm !== key) delete data[key]
          delete data[norm + "/"]
          data[parsed.storageKey] = info

          // First account for a provider becomes active by default.
          if (parsed.accountKey && !data[parsed.providerID]) {
            data[parsed.providerID] = info
          }

          yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
        }),
      )
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      yield* writeLock.withPermits(1)(
        Effect.gen(function* () {
          const norm = normalizeKey(key)
          const parsed = parseAuthStorageKey(norm)
          const data = yield* all()

          if (!parsed.accountKey) {
            for (const candidate of Object.keys(data)) {
              if (parseAuthStorageKey(candidate).providerID !== parsed.providerID) continue
              delete data[candidate]
            }
            delete data[key]
            delete data[norm]
            delete data[norm + "/"]
            yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
            return
          }

          const removed = data[parsed.storageKey]
          delete data[key]
          delete data[norm]
          delete data[parsed.storageKey]

          const active = data[parsed.providerID]
          if (active && removed && isDeepStrictEqual(active, removed)) {
            const replacement = Object.entries(data).find(([candidate]) => {
              const item = parseAuthStorageKey(candidate)
              return item.providerID === parsed.providerID && !!item.accountKey
            })
            if (replacement) data[parsed.providerID] = replacement[1]
            if (!replacement) delete data[parsed.providerID]
          }

          yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
        }),
      )
    })

    return Service.of({ get, all, accounts, active, activate, set, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Auth from "."
