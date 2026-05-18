import path from "path"
import { Effect, Layer, Option, Schema, Context, SynchronizedRef } from "effect"
import { Identifier } from "./util/identifier"
import { NonNegativeInt, withStatics } from "./schema"
import { Global } from "./global"
import { AppFileSystem } from "./filesystem"
import { PluginV2 } from "./plugin"

export const ID = Schema.String.pipe(
  Schema.brand("AccountV2.ID"),
  withStatics((schema) => ({ create: () => schema.make("acc_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type

export const ServiceID = Schema.String.pipe(Schema.brand("ServiceID"))
export type ServiceID = typeof ServiceID.Type

export class OAuthCredential extends Schema.Class<OAuthCredential>("AccountV2.OAuthCredential")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
}) {}

export class ApiKeyCredential extends Schema.Class<ApiKeyCredential>("AccountV2.ApiKeyCredential")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export const Credential = Schema.Union([OAuthCredential, ApiKeyCredential])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({
    identifier: "AccountV2.Credential",
  })
export type Credential = Schema.Schema.Type<typeof Credential>

export class Info extends Schema.Class<Info>("AccountV2.Info")({
  id: ID,
  serviceID: ServiceID,
  description: Schema.String,
  credential: Credential,
}) {}

export class FileWriteError extends Schema.TaggedErrorClass<FileWriteError>()("AccountV2.FileWriteError", {
  operation: Schema.Union([Schema.Literal("migrate"), Schema.Literal("write")]),
  cause: Schema.Defect,
}) {}

export type Error = FileWriteError

interface Writable {
  version: 2
  accounts: Record<string, Info>
  active: Record<string, ID>
}

const decodeV1 = Schema.decodeUnknownOption(Schema.Record(Schema.String, Credential))

function migrate(old: Record<string, unknown>): Writable {
  const accounts: Record<string, Info> = {}
  const active: Record<string, ID> = {}
  for (const [serviceID, value] of Object.entries(old)) {
    const decoded = Option.getOrElse(decodeV1({ [serviceID]: value }), () => ({}))
    const parsed = (decoded as Record<string, Credential>)[serviceID]
    if (!parsed) continue
    const id = Identifier.ascending()
    const account = ID.make(id)
    const brandedServiceID = ServiceID.make(serviceID)
    accounts[id] = new Info({
      id: account,
      serviceID: brandedServiceID,
      description: "default",
      credential: parsed,
    })
    active[brandedServiceID] = account
  }
  return { version: 2, accounts, active }
}

export interface Interface {
  readonly get: (id: ID) => Effect.Effect<Info | undefined, Error>
  readonly all: () => Effect.Effect<Info[], Error>
  readonly create: (input: {
    serviceID: ServiceID
    credential: Credential
    description?: string
    active?: boolean
  }) => Effect.Effect<Info | undefined, Error>
  readonly update: (id: ID, updates: Partial<Pick<Info, "description" | "credential">>) => Effect.Effect<void, Error>
  readonly remove: (id: ID) => Effect.Effect<void, Error>
  readonly activate: (id: ID) => Effect.Effect<void, Error>
  readonly active: (serviceID: ServiceID) => Effect.Effect<Info | undefined, Error>
  readonly forService: (serviceID: ServiceID) => Effect.Effect<Info[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Account") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const plugin = yield* PluginV2.Service
    const file = path.join(global.data, "account.json")
    const legacyFile = path.join(global.data, "auth.json")

    const writeMigrated = Effect.fnUntraced(function* (raw: Record<string, unknown>) {
      const migrated = migrate(raw)
      yield* fsys
        .writeJson(file, migrated, 0o600)
        .pipe(Effect.mapError((cause) => new FileWriteError({ operation: "migrate", cause })))
      return migrated
    })

    const parseAuthContent = () => {
      try {
        return JSON.parse(process.env.OPENCODE_AUTH_CONTENT ?? "")
      } catch {}
    }

    const load: () => Effect.Effect<Writable, Error> = Effect.fnUntraced(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        const raw = parseAuthContent()
        if (raw && typeof raw === "object") {
          if ("version" in raw && raw.version === 2) return raw as Writable
          return yield* writeMigrated(raw as Record<string, unknown>)
        }
        return { version: 2, accounts: {}, active: {} }
      }

      const legacy = yield* fsys.readJson(legacyFile).pipe(Effect.orElseSucceed(() => null))
      if (legacy && typeof legacy === "object") return yield* writeMigrated(legacy as Record<string, unknown>)

      const raw = yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => null))

      if (raw && typeof raw === "object") {
        if ("version" in raw && raw.version === 2) return raw as Writable
        return yield* writeMigrated(raw as Record<string, unknown>)
      }

      return { version: 2, accounts: {}, active: {} }
    })

    const write = (data: Writable) =>
      fsys
        .writeJson(file, data, 0o600)
        .pipe(Effect.mapError((cause) => new FileWriteError({ operation: "write", cause })))

    const state = SynchronizedRef.makeUnsafe(yield* load())

    const result: Interface = {
      get: Effect.fn("AccountV2.get")(function* (id) {
        return (yield* SynchronizedRef.get(state)).accounts[id]
      }),

      all: Effect.fn("AccountV2.all")(function* () {
        return Object.values((yield* SynchronizedRef.get(state)).accounts)
      }),

      active: Effect.fn("AccountV2.active")(function* (serviceID) {
        const data = yield* SynchronizedRef.get(state)
        return (
          data.accounts[data.active[serviceID]] ?? Object.values(data.accounts).find((a) => a.serviceID === serviceID)
        )
      }),

      forService: Effect.fn("AccountV2.list")(function* (serviceID) {
        return Object.values((yield* SynchronizedRef.get(state)).accounts).filter((a) => a.serviceID === serviceID)
      }),

      create: Effect.fn("AccountV2.add")(function* (input) {
        const id = ID.make(Identifier.ascending())
        const updated = yield* plugin.trigger(
          "account.update",
          { id, serviceID: input.serviceID },
          { description: input.description ?? "default", credential: input.credential, cancel: false },
        )
        if (updated.cancel) return undefined
        const account = new Info({
          id,
          serviceID: input.serviceID,
          description: updated.description,
          credential: updated.credential,
        })
        return yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
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

      update: Effect.fn("AccountV2.update")(function* (id, updates) {
        const existing = (yield* SynchronizedRef.get(state)).accounts[id]
        if (!existing) return
        const updated = yield* plugin.trigger(
          "account.update",
          { id, serviceID: existing.serviceID },
          {
            description: updates.description ?? existing.description,
            credential: updates.credential ?? existing.credential,
            cancel: false,
          },
        )
        if (updated.cancel) return
        yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            if (!data.accounts[id]) return [undefined, data] as const

            const next = {
              ...data,
              accounts: {
                ...data.accounts,
                [id]: new Info({
                  id,
                  serviceID: existing.serviceID,
                  description: updated.description,
                  credential: updated.credential,
                }),
              },
            }

            yield* write(next)
            return [undefined, next] as const
          }),
        )
      }),

      remove: Effect.fn("AccountV2.remove")(function* (id) {
        const account = (yield* SynchronizedRef.get(state)).accounts[id]
        if (!account) return
        if ((yield* plugin.trigger("account.remove", { account }, { cancel: false })).cancel) return
        yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            const accounts = { ...data.accounts }
            const active = { ...data.active }
            if (!accounts[id]) return [undefined, data] as const
            if (accounts[id] && active[accounts[id].serviceID] === id) delete active[accounts[id].serviceID]
            delete accounts[id]

            const next = { ...data, accounts, active }
            yield* write(next)
            return [undefined, next] as const
          }),
        )
      }),

      activate: Effect.fn("AccountV2.activate")(function* (id) {
        const data = yield* SynchronizedRef.get(state)
        const account = data.accounts[id]
        if (!account) return
        const updated = yield* plugin.trigger(
          "account.activate",
          {},
          { from: data.active[account.serviceID], to: id, cancel: false },
        )
        if (updated.cancel) return
        yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            const nextAccount = data.accounts[updated.to]
            if (!nextAccount) return [undefined, data] as const

            const next = { ...data, active: { ...data.active, [nextAccount.serviceID]: updated.to } }
            yield* write(next)
            return [undefined, next] as const
          }),
        )
      }),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.defaultLayer),
  Layer.provideMerge(PluginV2.defaultLayer),
)

export * as AccountV2 from "./account"
