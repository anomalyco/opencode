export * as McpTrustedHost from "./trust.js"

import { and, eq } from "drizzle-orm"
import { Context, DateTime, Effect, Layer } from "effect"
import type { Project } from "@opencode/schema/project"
import { Database } from "../database/database.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { TrustedHostTable } from "./trust.sql.js"

export interface Info {
  readonly projectID: Project.ID
  readonly host: string
  readonly port: number
  readonly fingerprint: string
  readonly subject: string
  readonly validTo: DateTime.Utc
  readonly time: {
    readonly created: DateTime.Utc
    readonly updated: DateTime.Utc
  }
}

export interface Key {
  readonly projectID: Project.ID
  readonly host: string
  readonly port: number
}

export interface PutInput extends Key {
  readonly fingerprint: string
  readonly subject: string
  readonly validTo: number
}

export interface Interface {
  readonly get: (input: Key) => Effect.Effect<Info | undefined>
  readonly put: (input: PutInput) => Effect.Effect<void>
  readonly remove: (input: Key) => Effect.Effect<void>
  readonly list: (projectID: Project.ID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpTrustedHost") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const where = (input: Key) =>
      and(
        eq(TrustedHostTable.project_id, input.projectID),
        eq(TrustedHostTable.host, input.host),
        eq(TrustedHostTable.port, input.port),
      )

    const get = Effect.fnUntraced(function* (input: Key) {
      const row = yield* db.select().from(TrustedHostTable).where(where(input)).get().pipe(Effect.orDie)
      return row ? info(row) : undefined
    })

    const put = Effect.fn("McpTrustedHost.put")(function* (input: PutInput) {
      yield* db
        .insert(TrustedHostTable)
        .values({
          project_id: input.projectID,
          host: input.host,
          port: input.port,
          fingerprint: input.fingerprint,
          subject: input.subject,
          valid_to: input.validTo,
        })
        .onConflictDoUpdate({
          target: [TrustedHostTable.project_id, TrustedHostTable.host, TrustedHostTable.port],
          set: { fingerprint: input.fingerprint, subject: input.subject, valid_to: input.validTo },
        })
        .run()
        .pipe(Effect.orDie)
    })

    const remove = Effect.fn("McpTrustedHost.remove")(function* (input: Key) {
      yield* db.delete(TrustedHostTable).where(where(input)).run().pipe(Effect.orDie)
    })

    const list = Effect.fnUntraced(function* (projectID: Project.ID) {
      const rows = yield* db
        .select()
        .from(TrustedHostTable)
        .where(eq(TrustedHostTable.project_id, projectID))
        .all()
        .pipe(Effect.orDie)
      return rows.map(info)
    })

    return Service.of({ get, put, remove, list })
  }),
)

const info = (row: typeof TrustedHostTable.$inferSelect): Info => ({
  projectID: row.project_id,
  host: row.host,
  port: row.port,
  fingerprint: row.fingerprint,
  subject: row.subject,
  validTo: DateTime.makeUnsafe(row.valid_to),
  time: {
    created: DateTime.makeUnsafe(row.time_created),
    updated: DateTime.makeUnsafe(row.time_updated),
  },
})

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
