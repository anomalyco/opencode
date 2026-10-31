export * as Credential from "./credential.js"

import { asc, desc, eq } from "drizzle-orm"
import { Cause, Context, Effect, Fiber, Layer, Schema, Semaphore } from "effect"
import { Credential } from "@opencode/schema/credential"
import { CredentialLegacy } from "@opencode/schema/credential-legacy"
import { Integration } from "@opencode/schema/integration"
import { supportsTuningPragmas } from "#sqlite"
import { Database } from "./database/database.js"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { EffectFlock } from "@opencode/util/effect-flock"
import { CredentialTable } from "./credential/sql.js"
import { ErrorSummary } from "./util/error-summary.js"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const External = Credential.External
export type External = Credential.External

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
  /** Concurrent callers for the same credential share the running operation's result, including failures. */
  readonly lock: (
    id: ID,
    operation: Effect.Effect<OAuth | undefined, unknown>,
  ) => Effect.Effect<OAuth | undefined, unknown>
  /**
   * Creates a credential for an integration and returns the new record. The new credential becomes the
   * integration's selection unless `activate` is false and the integration already has a credential.
   */
  readonly create: (input: {
    readonly id?: ID
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
    readonly activate?: boolean
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
    const flock = yield* EffectFlock.Service
    const scope = yield* Effect.scope
    const pending = new Map<ID, Fiber.Fiber<OAuth | undefined, unknown>>()
    // Rows written before v2.1 may carry the old key credential shape.
    const decode = Schema.decodeUnknownSync(CredentialLegacy.Value)
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

    type Snapshot = {
      readonly all: ReadonlyArray<Info>
      readonly byID: ReadonlyMap<ID, Info>
      readonly byIntegration: ReadonlyMap<Integration.ID, ReadonlyArray<Info>>
      readonly dataVersion: number | undefined
    }

    let cached: Snapshot | undefined
    let generation = 0
    const loadLock = yield* Semaphore.make(1)

    const invalidate = () => {
      generation += 1
      cached = undefined
    }

    // `PRAGMA data_version` increments when another SQLite connection commits to the same database file,
    // keeping CLI and server processes coherent without re-decoding every stored secret on each read.
    // Durable Object SQLite (`supportsTuningPragmas === false`) is single-connection and rejects tuning pragmas.
    const readDataVersion = () =>
      supportsTuningPragmas
        ? db.get<{ data_version: number | bigint }>("PRAGMA data_version").pipe(
            Effect.orDie,
            Effect.map((row) => (row ? Number(row.data_version) : undefined)),
          )
        : Effect.succeed(undefined)

    const buildSnapshot = (items: ReadonlyArray<Info>, dataVersion: number | undefined): Snapshot => {
      const byID = new Map<ID, Info>()
      const byIntegration = new Map<Integration.ID, Info[]>()
      for (const item of items) {
        byID.set(item.id, item)
        const group = byIntegration.get(item.integrationID)
        if (group) group.push(item)
        else byIntegration.set(item.integrationID, [item])
      }
      return { all: items, byID, byIntegration, dataVersion }
    }

    const snapshot = Effect.fnUntraced(function* () {
      const version = yield* readDataVersion()
      if (cached && cached.dataVersion === version) return cached
      return yield* loadLock.withPermits(1)(
        Effect.gen(function* () {
          const currentVersion = yield* readDataVersion()
          if (cached && cached.dataVersion === currentVersion) return cached
          const targetGeneration = generation
          const rows = yield* db
            .select()
            .from(CredentialTable)
            .orderBy(asc(CredentialTable.active), asc(CredentialTable.time_created), asc(CredentialTable.id))
            .all()
            .pipe(Effect.orDie)
          const next = buildSnapshot(storedRows(rows), currentVersion)
          if (generation === targetGeneration) cached = next
          return next
        }),
      )
    })

    return Service.of({
      lock: Effect.fn("Credential.lock")((id, operation) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const current = pending.get(id)
            if (current) return yield* restore(Fiber.join(current))
            // The global scope owns the operation, not the first Session or Location waiting for it.
            // The file lock extends this to other processes sharing the database.
            const fiber = yield* operation.pipe(
              flock.withLock(`credential-refresh:${id}`),
              Effect.ensuring(Effect.sync(() => pending.delete(id))),
              Effect.forkIn(scope),
            )
            pending.set(id, fiber)
            return yield* restore(Fiber.join(fiber))
          }),
        ),
      ),
      all: Effect.fn("Credential.all")(() => snapshot().pipe(Effect.map((state) => [...state.all]))),
      list: Effect.fn("Credential.list")((integrationID) =>
        snapshot().pipe(
          Effect.map((state) => {
            const items = state.byIntegration.get(integrationID)
            return items ? [...items] : []
          }),
        ),
      ),
      get: Effect.fn("Credential.get")((id) => snapshot().pipe(Effect.map((state) => state.byID.get(id)))),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Info({
          id: input.id ?? ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
        const activated = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const current = yield* tx
                .select({ id: CredentialTable.id, active: CredentialTable.active })
                .from(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integrationID))
                .orderBy(desc(CredentialTable.active), desc(CredentialTable.time_created), desc(CredentialTable.id))
                .get()
              const activate = input.activate !== false || !current
              if (activate)
                yield* tx
                  .update(CredentialTable)
                  .set({ active: false })
                  .where(eq(CredentialTable.integration_id, credential.integrationID))
                  .run()
              // Legacy rows have no active flag and the newest one is selected, so pin it before inserting a newer row.
              if (!activate && current && !current.active)
                yield* tx.update(CredentialTable).set({ active: true }).where(eq(CredentialTable.id, current.id)).run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  label: credential.label,
                  value: credential.value,
                  active: activate,
                })
                .run()
              return activate
            }),
          )
          .pipe(
            Effect.onError((cause) =>
              Effect.logError("credential create failed", {
                credentialID: credential.id,
                integrationID: credential.integrationID,
                errors: ErrorSummary.from(Cause.squash(cause)),
              }),
            ),
            Effect.orDie,
          )
        invalidate()
        yield* Effect.logInfo("credential created", {
          credentialID: credential.id,
          integrationID: credential.integrationID,
          type: credential.value.type,
          active: activated,
        })
        yield* bus.publish(Event.Updated, {}, { global: true })
        if (activated)
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
          .pipe(
            Effect.onError((cause) =>
              Effect.logError("credential activate failed", {
                credentialID: id,
                errors: ErrorSummary.from(Cause.squash(cause)),
              }),
            ),
            Effect.orDie,
          )
        if (integrationID) {
          invalidate()
          yield* Effect.logInfo("credential activated", { integrationID, credentialID: id })
          yield* bus.publish(Event.Switched, { integrationID, credentialID: id }, { global: true })
        }
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (updates.label === undefined && updates.value === undefined) return
        const credential = yield* db
          .select({ integrationID: CredentialTable.integration_id, label: CredentialTable.label })
          .from(CredentialTable)
          .where(eq(CredentialTable.id, id))
          .get()
          .pipe(
            Effect.onError((cause) =>
              Effect.logError("credential update lookup failed", {
                credentialID: id,
                errors: ErrorSummary.from(Cause.squash(cause)),
              }),
            ),
            Effect.orDie,
          )
        if (!credential?.integrationID) {
          yield* Effect.logWarning("credential update skipped", { credentialID: id, reason: "credential_missing" })
          return
        }
        if (updates.label === credential.label && updates.value === undefined) return
        const updated = yield* db
          .update(CredentialTable)
          .set({ label: updates.label, value: updates.value })
          .where(eq(CredentialTable.id, id))
          .returning({ id: CredentialTable.id })
          .get()
          .pipe(
            Effect.onError((cause) =>
              Effect.logError("credential update failed", {
                credentialID: id,
                integrationID: credential.integrationID,
                errors: ErrorSummary.from(Cause.squash(cause)),
              }),
            ),
            Effect.orDie,
          )
        if (!updated) {
          yield* Effect.logWarning("credential update skipped", { credentialID: id, reason: "credential_removed" })
          return
        }
        invalidate()
        yield* Effect.logInfo("credential updated", {
          credentialID: id,
          integrationID: credential.integrationID,
          valueChanged: updates.value !== undefined,
          labelChanged: updates.label !== undefined && updates.label !== credential.label,
        })
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
              if (!credential.integration_id || active?.id !== id)
                return { switched: false as const, integrationID: credential.integration_id }
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
          .pipe(
            Effect.onError((cause) =>
              Effect.logError("credential remove failed", {
                credentialID: id,
                errors: ErrorSummary.from(Cause.squash(cause)),
              }),
            ),
            Effect.orDie,
          )
        if (!removed) return
        invalidate()
        yield* Effect.logInfo("credential removed", {
          credentialID: id,
          integrationID: removed.integrationID,
          active: removed.switched,
          ...(removed.switched ? { replacementID: removed.credentialID } : {}),
        })
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

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Bus.node, EffectFlock.node] })
