export * as Credential from "./credential"

import { and, asc, eq, ne } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database } from "./database/database"
import { IntegrationSchema } from "./integration/schema"
import { EventV2 } from "./event"
import { NonNegativeInt, withStatics } from "./schema"
import { CredentialTable } from "./credential/sql"
import { Identifier } from "./util/identifier"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { DataMigrationTable } from "./data-migration.sql"
import path from "path"

export const ID = Schema.String.pipe(
  Schema.brand("Credential.ID"),
  withStatics((schema) => ({ create: () => schema.make("cred_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type

export class OAuth extends Schema.Class<OAuth>("Credential.OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class Key extends Schema.Class<Key>("Credential.Key")({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export const Value = Schema.Union([OAuth, Key])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Credential.Value" })
export type Value = Schema.Schema.Type<typeof Value>

const LegacyOAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
})

const LegacyKey = Schema.Struct({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

const LegacyValue = Schema.Union([LegacyOAuth, LegacyKey])

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: IntegrationSchema.ID,
  methodID: IntegrationSchema.MethodID,
  label: Schema.String,
  value: Value,
}) {}

export const Event = {
  Added: EventV2.define({
    type: "credential.added",
    schema: { credential: Info },
  }),
  Removed: EventV2.define({
    type: "credential.removed",
    schema: { credential: Info },
  }),
  Switched: EventV2.define({
    type: "credential.switched",
    schema: {
      integrationID: IntegrationSchema.ID,
      from: Schema.optional(ID),
      to: Schema.optional(ID),
    },
  }),
}

export interface Interface {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<Info[]>
  readonly create: (input: {
    integrationID: IntegrationSchema.ID
    methodID: IntegrationSchema.MethodID
    value: Value
    label?: string
  }) => Effect.Effect<Info>
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  readonly remove: (id: ID) => Effect.Effect<void>
  readonly activate: (id: ID) => Effect.Effect<void>
  readonly active: (integrationID: IntegrationSchema.ID) => Effect.Effect<Info | undefined>
  readonly activeAll: () => Effect.Effect<Map<IntegrationSchema.ID, Info>>
  readonly forIntegration: (integrationID: IntegrationSchema.ID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Credential") {}

export const legacyImportLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const name = "credential.auth-json"
    if (yield* db.select().from(DataMigrationTable).where(eq(DataMigrationTable.name, name)).get()) return
    const raw = yield* fs.readJson(path.join(global.data, "auth.json")).pipe(Effect.option)
    if (Option.isNone(raw) || typeof raw.value !== "object" || raw.value === null || Array.isArray(raw.value)) return
    const decode = Schema.decodeUnknownOption(LegacyValue)
    const values = Object.entries(raw.value).flatMap(([key, value]) => {
      const decoded = decode(value)
      if (Option.isNone(decoded)) return []
      const credential = decoded.value
      const id = ID.create()
      const integration = IntegrationSchema.ID.make(key.replace(/\/+$/, ""))
      const methodID = IntegrationSchema.MethodID.make(
        credential.type === "api"
          ? "api-key"
          : integration === IntegrationSchema.ID.make("openai")
            ? "chatgpt-browser"
            : "oauth",
      )
      const next: Value =
        credential.type === "api"
          ? new Key({ type: "key", key: credential.key, metadata: credential.metadata })
          : new OAuth({
              type: "oauth",
              refresh: credential.refresh,
              access: credential.access,
              expires: credential.expires,
              metadata: {
                ...(credential.accountId ? { accountID: credential.accountId } : {}),
                ...(credential.enterpriseUrl ? { enterpriseURL: credential.enterpriseUrl } : {}),
              },
            })
      return [{ id, integrationID: integration, methodID, value: next }]
    })
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        for (const item of values) {
          if (
            yield* tx
              .select({ id: CredentialTable.id })
              .from(CredentialTable)
              .where(eq(CredentialTable.integration_id, item.integrationID))
              .get()
          )
            continue
          yield* tx.insert(CredentialTable).values({
            id: item.id,
            integration_id: item.integrationID,
            method_id: item.methodID,
            label: "Imported",
            value: item.value,
            active: true,
          })
        }
        yield* tx.insert(DataMigrationTable).values({ name, time_completed: Date.now() }).onConflictDoNothing().run()
      }),
    )
  }).pipe(Effect.orDie),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const decodeValue = Schema.decodeUnknownSync(Value)
    const info = (row: typeof CredentialTable.$inferSelect) =>
      new Info({
        id: row.id,
        integrationID: row.integration_id,
        methodID: row.method_id,
        label: row.label,
        value: decodeValue(row.value),
      })

    const activate = Effect.fn("Credential.activate")(function* (id: ID) {
      const switched = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const credential = yield* tx.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get()
            if (!credential || credential.active) return
            const current = yield* tx
              .select({ id: CredentialTable.id })
              .from(CredentialTable)
              .where(
                and(eq(CredentialTable.integration_id, credential.integration_id), eq(CredentialTable.active, true)),
              )
              .get()
            yield* tx
              .update(CredentialTable)
              .set({ active: false })
              .where(eq(CredentialTable.integration_id, credential.integration_id))
              .run()
            yield* tx.update(CredentialTable).set({ active: true }).where(eq(CredentialTable.id, id)).run()
            return { integrationID: credential.integration_id, from: current?.id, to: id }
          }),
        )
        .pipe(Effect.orDie)
      if (switched) yield* events.publish(Event.Switched, switched)
    })

    return Service.of({
      get: Effect.fn("Credential.get")(function* (id) {
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        return row ? info(row) : undefined
      }),
      all: Effect.fn("Credential.all")(function* () {
        return (yield* db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).map(info)
      }),
      active: Effect.fn("Credential.active")(function* (integrationID) {
        const row = yield* db
          .select()
          .from(CredentialTable)
          .where(and(eq(CredentialTable.integration_id, integrationID), eq(CredentialTable.active, true)))
          .get()
          .pipe(Effect.orDie)
        return row ? info(row) : undefined
      }),
      activeAll: Effect.fn("Credential.activeAll")(function* () {
        const rows = yield* db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.active, true))
          .all()
          .pipe(Effect.orDie)
        return new Map(rows.map((row) => [row.integration_id, info(row)]))
      }),
      forIntegration: Effect.fn("Credential.forIntegration")(function* (integrationID) {
        return (yield* db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, integrationID))
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).map(info)
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Info({
          id: ID.create(),
          integrationID: input.integrationID,
          methodID: input.methodID,
          label: input.label ?? "default",
          value: input.value,
        })
        const from = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const current = yield* tx
                .select({ id: CredentialTable.id })
                .from(CredentialTable)
                .where(and(eq(CredentialTable.integration_id, input.integrationID), eq(CredentialTable.active, true)))
                .get()
              yield* tx
                .update(CredentialTable)
                .set({ active: false })
                .where(eq(CredentialTable.integration_id, input.integrationID))
                .run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  method_id: credential.methodID,
                  label: credential.label,
                  value: credential.value,
                  active: true,
                })
                .run()
              return current?.id
            }),
          )
          .pipe(Effect.orDie)
        yield* events.publish(Event.Added, { credential })
        yield* events.publish(Event.Switched, { integrationID: credential.integrationID, from, to: credential.id })
        return credential
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (!updates.label && !updates.value) return
        yield* db
          .update(CredentialTable)
          .set({ label: updates.label, value: updates.value })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        const removed = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* tx.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get()
              if (!row) return
              yield* tx.delete(CredentialTable).where(eq(CredentialTable.id, id)).run()
              if (!row.active) return { credential: info(row) }
              const replacement = yield* tx
                .select()
                .from(CredentialTable)
                .where(and(eq(CredentialTable.integration_id, row.integration_id), ne(CredentialTable.id, id)))
                .orderBy(asc(CredentialTable.time_created))
                .get()
              if (replacement) {
                yield* tx
                  .update(CredentialTable)
                  .set({ active: true })
                  .where(eq(CredentialTable.id, replacement.id))
                  .run()
              }
              return {
                credential: info(row),
                switched: { integrationID: row.integration_id, from: id, to: replacement?.id },
              }
            }),
          )
          .pipe(Effect.orDie)
        if (!removed) return
        yield* events.publish(Event.Removed, { credential: removed.credential })
        if (removed.switched) yield* events.publish(Event.Switched, removed.switched)
      }),
      activate,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provideMerge(
    legacyImportLayer.pipe(
      Layer.provide(Database.defaultLayer),
      Layer.provide(FSUtil.defaultLayer),
      Layer.provide(Global.defaultLayer),
    ),
  ),
)
