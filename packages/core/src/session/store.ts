export * as SessionStore from "./store.js"

import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { SessionHistory } from "./history.js"
import { MessageDecodeError } from "./error.js"
import { SessionMessage } from "./message.js"
import { Session } from "@opencode-ai/schema/session"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "./sql.js"
import { fromRow } from "./info.js"

export type Background =
  | {
      readonly type: "shell"
      readonly sessionID: Session.ID
      readonly id: string
      readonly shellID: string
      readonly description: string
    }
  | {
      readonly type: "subagent"
      readonly sessionID: Session.ID
      readonly id: Session.ID
      readonly agent: string
      readonly description: string
    }

export interface Interface {
  readonly get: (sessionID: Session.ID) => Effect.Effect<Session.Info | undefined>
  readonly context: (sessionID: Session.ID) => Effect.Effect<SessionMessage.Info[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: Session.ID; readonly message: SessionMessage.Info } | undefined>
  /**
   * Top-level Sessions holding an execution claim. Child (subagent) Sessions
   * are excluded: a resumed parent re-runs its tool call and spawns fresh
   * children, so resuming orphaned children would duplicate their work.
   */
  readonly listSuspended: () => Effect.Effect<ReadonlyArray<Session.ID>>
  readonly listBackground: () => Effect.Effect<ReadonlyArray<Background>>
  /**
   * Records the execution claim: the durable write-ahead intent that a turn is
   * (or was) in flight. Set when execution starts; a claim that survives to the
   * next boot marks a turn that never completed — its process crashed or shut
   * down mid-turn.
   */
  readonly claim: (sessionID: Session.ID) => Effect.Effect<void>
  /** Releases the claim and resets resume accounting. Terminal events call this on commit. */
  readonly release: (sessionID: Session.ID) => Effect.Effect<void>
  /**
   * Clears orphaned child (subagent) claims. Children are never resumed
   * independently, so a dead child's claim is noise no terminal will ever
   * release.
   */
  readonly releaseChildClaims: Effect.Effect<void>
  /**
   * Durably counts one more resume of an orphaned claim, returning the new
   * total — or undefined when the Session no longer exists.
   */
  readonly countResume: (sessionID: Session.ID) => Effect.Effect<number | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStore") {}

const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Json))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      get: Effect.fnUntraced(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      }),
      context: Effect.fn("SessionStore.context")((sessionID) => SessionHistory.load(db, sessionID)),
      message: Effect.fn("SessionStore.message")(function* (messageID) {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        return row
          ? {
              sessionID: Session.ID.make(row.session_id),
              message: yield* SessionHistory.decodeMessageRow(row).pipe(Effect.orDie),
            }
          : undefined
      }),
      listSuspended: Effect.fn("SessionStore.listSuspended")(function* () {
        return yield* db
          .select({ sessionID: SessionTable.id })
          .from(SessionTable)
          .where(and(isNotNull(SessionTable.time_suspended), isNull(SessionTable.parent_id)))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.map((row) => row.sessionID)),
          )
      }),
      listBackground: Effect.fn("SessionStore.listBackground")(function* () {
        const rows = yield* db
          .select({ value: KVTable.value })
          .from(KVTable)
          .innerJoin(SessionTable, sql`${SessionTable.id} = json_extract(${KVTable.value}, '$.sessionID')`)
          .where(
            and(
              gte(KVTable.key, "session.background/"),
              lt(KVTable.key, "session.background0"),
              sql`NOT EXISTS (
                SELECT 1 FROM ${SessionInboxTable}
                WHERE ${SessionInboxTable.session_id} = ${SessionTable.id}
                  AND ${SessionInboxTable.type} = 'synthetic'
                  AND json_extract(${SessionInboxTable.payload}, '$.metadata.source')
                    = json_extract(${KVTable.value}, '$.type')
                  AND json_extract(${SessionInboxTable.payload}, '$.metadata.state')
                    IN ('completed', 'error', 'cancelled')
                  AND (
                    (json_extract(${KVTable.value}, '$.type') = 'shell'
                      AND json_extract(${SessionInboxTable.payload}, '$.metadata.shellID')
                        = json_extract(${KVTable.value}, '$.shellID'))
                    OR (json_extract(${KVTable.value}, '$.type') = 'subagent'
                      AND json_extract(${SessionInboxTable.payload}, '$.metadata.childID')
                        = json_extract(${KVTable.value}, '$.id'))
                  )
              )`,
            ),
          )
          .all()
          .pipe(Effect.orDie)
        return rows.flatMap((row): Background[] => {
          const value = row.value
          if (!isRecord(value)) return []
          if (
            typeof value.sessionID !== "string" ||
            typeof value.id !== "string" ||
            typeof value.description !== "string"
          )
            return []
          if (value.type === "shell" && typeof value.shellID === "string")
            return [
              {
                type: "shell",
                sessionID: Session.ID.make(value.sessionID),
                id: value.id,
                shellID: value.shellID,
                description: value.description,
              },
            ]
          if (value.type !== "subagent" || typeof value.agent !== "string") return []
          return [
            {
              type: "subagent",
              sessionID: Session.ID.make(value.sessionID),
              id: Session.ID.make(value.id),
              agent: value.agent,
              description: value.description,
            },
          ]
        })
      }),
      claim: Effect.fn("SessionStore.claim")(function* (sessionID) {
        // The null guard makes re-claiming a still-claimed Session a zero-row
        // no-op (a resumed turn re-claims through the same started hook).
        // Claim bookkeeping never counts as user activity: time_updated is
        // pinned so session ordering only moves on real changes.
        yield* db
          .update(SessionTable)
          .set({ time_suspended: Date.now(), time_updated: sql`${SessionTable.time_updated}` })
          .where(and(eq(SessionTable.id, sessionID), isNull(SessionTable.time_suspended)))
          .run()
          .pipe(Effect.orDie)
      }),
      release: Effect.fn("SessionStore.release")(function* (sessionID) {
        yield* db
          .update(SessionTable)
          .set({ time_suspended: null, resume_attempts: 0, time_updated: sql`${SessionTable.time_updated}` })
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
      releaseChildClaims: db
        .update(SessionTable)
        .set({ time_suspended: null, resume_attempts: 0, time_updated: sql`${SessionTable.time_updated}` })
        .where(and(isNotNull(SessionTable.time_suspended), isNotNull(SessionTable.parent_id)))
        .run()
        .pipe(Effect.orDie, Effect.asVoid, Effect.withSpan("SessionStore.releaseChildClaims")),
      countResume: Effect.fn("SessionStore.countResume")(function* (sessionID) {
        const row = yield* db
          .update(SessionTable)
          .set({
            resume_attempts: sql`${SessionTable.resume_attempts} + 1`,
            time_updated: sql`${SessionTable.time_updated}`,
          })
          .where(eq(SessionTable.id, sessionID))
          .returning({ attempts: SessionTable.resume_attempts })
          .get()
          .pipe(Effect.orDie)
        return row?.attempts
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
