export * as Credential from "./credential.js"

import { asc, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Credential } from "@opencode-ai/schema/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { Database } from "./database/database.js"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { CredentialTable } from "./credential/sql.js"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const Value = Credential.Value
export type Value = Credential.Value

export const Event = Credential.Event

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
}) {}

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Creates a credential for an integration and returns the new record. */
  readonly create: (input: {
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
  }) => Effect.Effect<Info>
  /** Selects a stored credential for its integration. */
  readonly activate: (id: ID) => Effect.Effect<void>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Credential") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    const decode = Schema.decodeUnknownSync(Value)
    const stored = (row: typeof CredentialTable.$inferSelect) => {
      if (!row.integration_id) return
      return new Info({
        id: row.id,
        integrationID: row.integration_id,
        label: row.label,
        value: decode(row.value),
      })
    }
    const storedRows = (rows: ReadonlyArray<typeof CredentialTable.$inferSelect>) =>
      rows.flatMap((row) => {
        const credential = stored(row)
        return credential ? [credential] : []
      })

    return Service.of({
      all: Effect.fn("Credential.all")(() =>
        db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.active), asc(CredentialTable.time_created), asc(CredentialTable.id))
          .all()
          .pipe(Effect.orDie, Effect.map(storedRows)),
      ),
      list: Effect.fn("Credential.list")((integrationID) =>
        db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, integrationID))
          .orderBy(asc(CredentialTable.active), asc(CredentialTable.time_created), asc(CredentialTable.id))
          .all()
          .pipe(Effect.orDie, Effect.map(storedRows)),
      ),
      get: Effect.fn("Credential.get")(function* (id) {
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        return row ? stored(row) : undefined
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Info({
          id: ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(CredentialTable)
                .set({ active: false })
                .where(eq(CredentialTable.integration_id, credential.integrationID))
                .run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  label: credential.label,
                  value: credential.value,
                  active: true,
                })
                .run()
            }),
          )
          .pipe(Effect.orDie)
        yield* bus.publish(Event.Updated, {}, { global: true })
        yield* bus.publish(
          Event.Switched,
          { integrationID: credential.integrationID, credentialID: credential.id },
          { global: true },
        )
        return credential
      }),
      activate: Effect.fn("Credential.activate")(function* (id) {
        const integrationID = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const credential = yield* tx.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get()
              if (!credential?.integration_id) return
              const active = yield* tx
                .select({ id: CredentialTable.id })
                .from(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integration_id))
                .orderBy(desc(CredentialTable.active), desc(CredentialTable.time_created), desc(CredentialTable.id))
                .get()
              if (active?.id === id) return
              yield* tx
                .update(CredentialTable)
                .set({ active: false })
                .where(eq(CredentialTable.integration_id, credential.integration_id))
                .run()
              yield* tx.update(CredentialTable).set({ active: true }).where(eq(CredentialTable.id, id)).run()
              return credential.integration_id
            }),
          )
          .pipe(Effect.orDie)
        if (integrationID) yield* bus.publish(Event.Switched, { integrationID, credentialID: id }, { global: true })
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (updates.label === undefined && updates.value === undefined) return
        const credential = yield* db
          .select({ integrationID: CredentialTable.integration_id, label: CredentialTable.label })
          .from(CredentialTable)
          .where(eq(CredentialTable.id, id))
          .get()
          .pipe(Effect.orDie)
        if (!credential?.integrationID) return
        if (updates.label === credential.label && updates.value === undefined) return
        yield* db
          .update(CredentialTable)
          .set({ label: updates.label, value: updates.value })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
        if (updates.label !== undefined && updates.label !== credential.label)
          yield* bus.publish(Event.Updated, {}, { global: true })
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        const removed = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const credential = yield* tx.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get()
              if (!credential) return
              const active = credential.integration_id
                ? yield* tx
                    .select({ id: CredentialTable.id })
                    .from(CredentialTable)
                    .where(eq(CredentialTable.integration_id, credential.integration_id))
                    .orderBy(desc(CredentialTable.active), desc(CredentialTable.time_created), desc(CredentialTable.id))
                    .get()
                : undefined
              yield* tx.delete(CredentialTable).where(eq(CredentialTable.id, id)).run()
              if (!credential.integration_id || active?.id !== id) return { switched: false as const }
              const replacement = yield* tx
                .select({ id: CredentialTable.id })
                .from(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integration_id))
                .orderBy(desc(CredentialTable.time_created), desc(CredentialTable.id))
                .get()
              if (replacement) {
                yield* tx
                  .update(CredentialTable)
                  .set({ active: false })
                  .where(eq(CredentialTable.integration_id, credential.integration_id))
                  .run()
                yield* tx
                  .update(CredentialTable)
                  .set({ active: true })
                  .where(eq(CredentialTable.id, replacement.id))
                  .run()
              }
              return {
                switched: true as const,
                integrationID: credential.integration_id,
                credentialID: replacement?.id ?? null,
              }
            }),
          )
          .pipe(Effect.orDie)
        if (!removed) return
        yield* bus.publish(Event.Updated, {}, { global: true })
        if (removed.switched)
          yield* bus.publish(
            Event.Switched,
            { integrationID: removed.integrationID, credentialID: removed.credentialID },
            { global: true },
          )
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Bus.node] })
