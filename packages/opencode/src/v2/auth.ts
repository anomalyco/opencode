import path from "path"
import { Effect, Layer, Option, Schema, Context, SynchronizedRef } from "effect"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { NonNegativeInt, withStatics } from "@/util/schema"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const AccountID = Schema.String.pipe(
  Schema.brand("AccountID"),
  withStatics((schema) => ({ create: () => schema.make("acc_" + Identifier.ascending()) })),
)
export type AccountID = typeof AccountID.Type

export const ServiceID = Schema.String.pipe(Schema.brand("ServiceID"))
export type ServiceID = typeof ServiceID.Type

export class OAuthCredential extends Schema.Class<OAuthCredential>("AuthV2.OAuthCredential")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
}) {}

export class ApiKeyCredential extends Schema.Class<ApiKeyCredential>("AuthV2.ApiKeyCredential")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export const Credential = Schema.Union([OAuthCredential, ApiKeyCredential])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({
    identifier: "AuthV2.Credential",
  })
export type Credential = Schema.Schema.Type<typeof Credential>

export class Account extends Schema.Class<Account>("AuthV2.Account")({
  id: AccountID,
  serviceID: ServiceID,
  description: Schema.String,
  credential: Credential,
}) {}

export class AuthFileWriteError extends Schema.TaggedErrorClass<AuthFileWriteError>()("AuthV2.FileWriteError", {
  operation: Schema.Union([Schema.Literal("migrate"), Schema.Literal("write")]),
  cause: Schema.Defect,
}) {}

export type AuthError = AuthFileWriteError

interface Writable {
  version: 2
  accounts: Record<string, Account>
  active: Record<string, AccountID>
}

const decodeV1 = Schema.decodeUnknownOption(Schema.Record(Schema.String, Credential))

function migrate(old: Record<string, unknown>): Writable {
  const accounts: Record<string, Account> = {}
  const active: Record<string, AccountID> = {}
  for (const [serviceID, value] of Object.entries(old)) {
    const decoded = Option.getOrElse(decodeV1({ [serviceID]: value }), () => ({}))
    const parsed = (decoded as Record<string, Credential>)[serviceID]
    if (!parsed) continue
    const id = Identifier.ascending()
    const accountID = AccountID.make(id)
    const brandedServiceID = ServiceID.make(serviceID)
    accounts[id] = new Account({
      id: accountID,
      serviceID: brandedServiceID,
      description: "default",
      credential: parsed,
    })
    active[brandedServiceID] = accountID
  }
  return { version: 2, accounts, active }
}

export interface Interface {
  readonly get: (accountID: AccountID) => Effect.Effect<Account | undefined, AuthError>
  readonly all: () => Effect.Effect<Account[], AuthError>
  readonly create: (input: {
    serviceID: ServiceID
    credential: Credential
    description?: string
    active?: boolean
  }) => Effect.Effect<Account, AuthError>
  readonly update: (
    accountID: AccountID,
    updates: Partial<Pick<Account, "description" | "credential">>,
  ) => Effect.Effect<void, AuthError>
  readonly remove: (accountID: AccountID) => Effect.Effect<void, AuthError>
  readonly activate: (accountID: AccountID) => Effect.Effect<void, AuthError>
  readonly active: (serviceID: ServiceID) => Effect.Effect<Account | undefined, AuthError>
  readonly forService: (serviceID: ServiceID) => Effect.Effect<Account[], AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const file = path.join(global.data, "auth-v2.json")

    const load: () => Effect.Effect<Writable, AuthError> = Effect.fnUntraced(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch {}
      }

      const raw = yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => null))

      if (!raw || typeof raw !== "object") return { version: 2, accounts: {}, active: {} }

      if ("version" in raw && raw.version === 2) return raw as Writable

      const migrated = migrate(raw as Record<string, unknown>)
      yield* fsys
        .writeJson(file, migrated, 0o600)
        .pipe(Effect.mapError((cause) => new AuthFileWriteError({ operation: "migrate", cause })))
      return migrated
    })

    const write = (data: Writable) =>
      fsys
        .writeJson(file, data, 0o600)
        .pipe(Effect.mapError((cause) => new AuthFileWriteError({ operation: "write", cause })))

    const state = SynchronizedRef.makeUnsafe(yield* load())

    const result: Interface = {
      get: Effect.fn("AuthV2.get")(function* (accountID) {
        return (yield* SynchronizedRef.get(state)).accounts[accountID]
      }),

      all: Effect.fn("AuthV2.all")(function* () {
        return Object.values((yield* SynchronizedRef.get(state)).accounts)
      }),

      active: Effect.fn("AuthV2.active")(function* (serviceID) {
        const data = yield* SynchronizedRef.get(state)
        return (
          data.accounts[data.active[serviceID]] ?? Object.values(data.accounts).find((a) => a.serviceID === serviceID)
        )
      }),

      forService: Effect.fn("AuthV2.list")(function* (serviceID) {
        return Object.values((yield* SynchronizedRef.get(state)).accounts).filter((a) => a.serviceID === serviceID)
      }),

      create: Effect.fn("AuthV2.add")(function* (input) {
        return yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            const account = new Account({
              id: AccountID.make(Identifier.ascending()),
              serviceID: input.serviceID,
              description: input.description ?? "default",
              credential: input.credential,
            })
            const next = {
              ...data,
              accounts: { ...data.accounts, [account.id]: account },
              active:
                (input.active ?? Object.values(data.accounts).every((a) => a.serviceID !== input.serviceID))
                  ? { ...data.active, [input.serviceID]: account.id }
                  : data.active,
            }

            yield* write(next)
            return [account, next] as const
          }),
        )
      }),

      update: Effect.fn("AuthV2.update")(function* (accountID, updates) {
        yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            const existing = data.accounts[accountID]
            if (!existing) return [undefined, data] as const

            const next = {
              ...data,
              accounts: {
                ...data.accounts,
                [accountID]: new Account({
                  id: accountID,
                  serviceID: existing.serviceID,
                  description: updates.description ?? existing.description,
                  credential: updates.credential ?? existing.credential,
                }),
              },
            }

            yield* write(next)
            return [undefined, next] as const
          }),
        )
      }),

      remove: Effect.fn("AuthV2.remove")(function* (accountID) {
        yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            const accounts = { ...data.accounts }
            const active = { ...data.active }
            if (accounts[accountID] && active[accounts[accountID].serviceID] === accountID)
              delete active[accounts[accountID].serviceID]
            delete accounts[accountID]

            const next = { ...data, accounts, active }
            yield* write(next)
            return [undefined, next] as const
          }),
        )
      }),

      activate: Effect.fn("AuthV2.activate")(function* (accountID) {
        yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            const account = data.accounts[accountID]
            if (!account) return [undefined, data] as const

            const next = { ...data, active: { ...data.active, [account.serviceID]: accountID } }
            yield* write(next)
            return [undefined, next] as const
          }),
        )
      }),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer), Layer.provide(Global.defaultLayer))

export * as AuthV2 from "./auth"
