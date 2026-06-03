export * as Auth from "./auth"

import path from "path"
import { Effect, Layer, Option, Schema, Context, SynchronizedRef } from "effect"
import { Identifier } from "./util/identifier"
import { NonNegativeInt, withStatics } from "./schema"
import { Global } from "./global"
import { FSUtil } from "./fs-util"
import { EventV2 } from "./event"

export const ID = Schema.String.pipe(
  Schema.brand("Auth.ID"),
  withStatics((schema) => ({ create: () => schema.make("acc_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type

export const ServiceID = Schema.String.pipe(Schema.brand("ServiceID"))
export type ServiceID = typeof ServiceID.Type

export const OrgID = Schema.String.pipe(Schema.brand("OrgID"))
export type OrgID = typeof OrgID.Type
export const AccessToken = Schema.String.pipe(Schema.brand("AccessToken"))
export type AccessToken = typeof AccessToken.Type
export const RefreshToken = Schema.String.pipe(Schema.brand("RefreshToken"))
export type RefreshToken = typeof RefreshToken.Type

export class OAuthCredential extends Schema.Class<OAuthCredential>("Auth.OAuthCredential")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
}) {}

export class ApiKeyCredential extends Schema.Class<ApiKeyCredential>("Auth.ApiKeyCredential")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export const Credential = Schema.Union([OAuthCredential, ApiKeyCredential])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({
    identifier: "Auth.Credential",
  })
export type Credential = Schema.Schema.Type<typeof Credential>

export class Info extends Schema.Class<Info>("Auth.Info")({
  id: ID,
  serviceID: ServiceID,
  description: Schema.String,
  credential: Credential,
}) {}

export class FileWriteError extends Schema.TaggedErrorClass<FileWriteError>()("Auth.FileWriteError", {
  operation: Schema.Union([Schema.Literal("migrate"), Schema.Literal("write")]),
  cause: Schema.Defect,
}) {}

export type Error = FileWriteError

export const Event = {
  Added: EventV2.define({
    type: "account.added",
    schema: {
      account: Info,
    },
  }),
  Removed: EventV2.define({
    type: "account.removed",
    schema: {
      account: Info,
    },
  }),
  Switched: EventV2.define({
    type: "account.switched",
    schema: {
      serviceID: ServiceID,
      from: Schema.optional(ID),
      to: Schema.optional(ID),
    },
  }),
}

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
  }) => Effect.Effect<Info | undefined, Error>
  readonly update: (id: ID, updates: Partial<Pick<Info, "description" | "credential">>) => Effect.Effect<void, Error>
  readonly remove: (id: ID) => Effect.Effect<void, Error>
  readonly activate: (id: ID) => Effect.Effect<void, Error>
  readonly active: (serviceID: ServiceID) => Effect.Effect<Info | undefined, Error>
  readonly activeAll: () => Effect.Effect<Map<ServiceID, Info>, Error>
  readonly forService: (serviceID: ServiceID) => Effect.Effect<Info[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Account") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const global = yield* Global.Service
    const events = yield* EventV2.Service
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

    const state = SynchronizedRef.makeUnsafe(
      yield* load().pipe(Effect.orElseSucceed((): Writable => ({ version: 2, accounts: {}, active: {} }))),
    )

    const activate = Effect.fn("Auth.activate")(function* (id: ID) {
      const data = yield* SynchronizedRef.get(state)
      const account = data.accounts[id]
      if (!account) return
      const activated = yield* SynchronizedRef.modifyEffect(
        state,
        Effect.fnUntraced(function* (data) {
          const nextAccount = data.accounts[id]
          if (!nextAccount) return [undefined, data] as const

          const next = { ...data, active: { ...data.active, [nextAccount.serviceID]: id } }
          yield* write(next)
          return [{ serviceID: nextAccount.serviceID, from: data.active[nextAccount.serviceID], to: id }, next] as const
        }),
      )
      if (activated) yield* events.publish(Event.Switched, activated)
    })

    const result: Interface = {
      get: Effect.fn("Auth.get")(function* (id) {
        return (yield* SynchronizedRef.get(state)).accounts[id]
      }),

      all: Effect.fn("Auth.all")(function* () {
        return Object.values((yield* SynchronizedRef.get(state)).accounts)
      }),

      active: Effect.fn("Auth.active")(function* (serviceID) {
        const data = yield* SynchronizedRef.get(state)
        return (
          data.accounts[data.active[serviceID]] ?? Object.values(data.accounts).find((a) => a.serviceID === serviceID)
        )
      }),

      activeAll: Effect.fn("Auth.activeAll")(function* () {
        const data = yield* SynchronizedRef.get(state)
        const result = new Map<ServiceID, Info>()
        for (const account of Object.values(data.accounts)) {
          if (!result.has(account.serviceID)) result.set(account.serviceID, account)
        }
        for (const [serviceID, id] of Object.entries(data.active)) {
          const account = data.accounts[id]
          if (account) result.set(ServiceID.make(serviceID), account)
        }
        return result
      }),

      forService: Effect.fn("Auth.list")(function* (serviceID) {
        return Object.values((yield* SynchronizedRef.get(state)).accounts).filter((a) => a.serviceID === serviceID)
      }),

      create: Effect.fn("Auth.add")(function* (input) {
        const id = ID.make(Identifier.ascending())
        const account = new Info({
          id,
          serviceID: input.serviceID,
          description: input.description ?? "default",
          credential: input.credential,
        })
        const added = yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            const next = {
              ...data,
              accounts: { ...data.accounts, [account.id]: account },
              active: { ...data.active, [account.serviceID]: account.id },
            }

            yield* write(next)
            return [
              {
                account,
                switched: { serviceID: account.serviceID, from: data.active[account.serviceID], to: account.id },
              },
              next,
            ] as const
          }),
        )
        yield* events.publish(Event.Added, { account: added.account })
        yield* events.publish(Event.Switched, added.switched)
        return added.account
      }),

      update: Effect.fn("Auth.update")(function* (id, updates) {
        const existing = (yield* SynchronizedRef.get(state)).accounts[id]
        if (!existing) return
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

      remove: Effect.fn("Auth.remove")(function* (id) {
        const removed = yield* SynchronizedRef.modifyEffect(
          state,
          Effect.fnUntraced(function* (data) {
            const accounts = { ...data.accounts }
            const active = { ...data.active }
            const removed = accounts[id]
            if (!removed) return [undefined, data] as const
            const wasActive = active[removed.serviceID] === id
            delete accounts[id]
            const replacement = Object.values(accounts).find((account) => account.serviceID === removed.serviceID)
            if (wasActive) {
              if (replacement) active[removed.serviceID] = replacement.id
              else delete active[removed.serviceID]
            }

            const next = { ...data, accounts, active }
            yield* write(next)
            return [
              {
                account: removed,
                switched: wasActive ? { serviceID: removed.serviceID, from: id, to: replacement?.id } : undefined,
              },
              next,
            ] as const
          }),
        )
        if (removed) {
          yield* events.publish(Event.Removed, { account: removed.account })
          if (removed.switched) yield* events.publish(Event.Switched, removed.switched)
        }
      }),

      activate,
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
)
