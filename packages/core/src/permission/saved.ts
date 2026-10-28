export * as PermissionSaved from "./saved.js"

import { eq } from "drizzle-orm"
import { Cause, Context, DateTime, Effect, Layer, Schema } from "effect"
import { isSqlError } from "effect/sql/SqlError"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import type { Project } from "@opencode/schema/project"
import { Database } from "../database/database.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { PermissionTable } from "./sql.js"
import { PermissionSaved } from "@opencode/schema/permission-saved"

export const ID = PermissionSaved.ID
export type ID = typeof ID.Type

export const Info = PermissionSaved.Info
export type Info = typeof Info.Type

export interface ListInput {
  readonly projectID?: Project.ID
}

export interface AddInput {
  readonly projectID: Project.ID
  readonly action: string
  readonly resources: readonly string[]
}

export interface UpdateInput {
  readonly id: ID
  readonly action?: string
  readonly resource?: string
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("PermissionSaved.NotFoundError", {
  id: ID,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("PermissionSaved.ConflictError", {
  id: ID,
  action: Schema.String,
  resource: Schema.String,
}) {}

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<ReadonlyArray<Info>>
  readonly add: (input: AddInput) => Effect.Effect<void>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError | ConflictError>
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionSaved") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const list = Effect.fnUntraced(function* (input?: ListInput) {
      const rows = yield* db
        .select()
        .from(PermissionTable)
        .where(input?.projectID ? eq(PermissionTable.project_id, input.projectID) : undefined)
        .all()
        .pipe(Effect.orDie)
      return rows.map(info)
    })

    const add = Effect.fn("PermissionSaved.add")(function* (input: AddInput) {
      if (!input.resources.length) return
      yield* db
        .insert(PermissionTable)
        .values(
          input.resources.map((resource) => ({
            id: ID.create(),
            project_id: input.projectID,
            action: input.action,
            resource,
          })),
        )
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    })

    const update = Effect.fn("PermissionSaved.update")(function* (input: UpdateInput) {
      const current = yield* db
        .select()
        .from(PermissionTable)
        .where(eq(PermissionTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* new NotFoundError({ id: input.id })
      const action = input.action ?? current.action
      const resource = input.resource ?? current.resource
      // The unique index rejects an edit that duplicates another saved permission in the project.
      const updated = yield* db
        .update(PermissionTable)
        .set({ action, resource })
        .where(eq(PermissionTable.id, input.id))
        .returning()
        .get()
        .pipe(
          Effect.catchIf(isUniqueViolation, () => new ConflictError({ id: input.id, action, resource })),
          Effect.catchTag("EffectDrizzleQueryError", (error) => Effect.die(error)),
        )
      if (!updated) return yield* new NotFoundError({ id: input.id })
      return info(updated)
    })

    const remove = Effect.fn("PermissionSaved.remove")(function* (id: ID) {
      yield* db.delete(PermissionTable).where(eq(PermissionTable.id, id)).run().pipe(Effect.orDie)
    })

    return Service.of({ list, add, update, remove })
  }),
)

// Durable Object SQLite throws a plain Error without SQLite codes, so its unique violation is only in the message.
const isUniqueViolation = (error: EffectDrizzleQueryError) => {
  const sql = Cause.isCause(error.cause) ? Cause.squash(error.cause) : error.cause
  if (!isSqlError(sql)) return false
  return (
    sql.reason._tag === "UniqueViolation" ||
    (sql.reason.cause instanceof Error && sql.reason.cause.message.includes("SQLITE_CONSTRAINT_UNIQUE"))
  )
}

const info = (row: typeof PermissionTable.$inferSelect): Info => ({
  id: row.id,
  projectID: row.project_id,
  action: row.action,
  resource: row.resource,
  time: {
    created: DateTime.makeUnsafe(row.time_created),
    updated: DateTime.makeUnsafe(row.time_updated),
  },
})

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
