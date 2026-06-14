/**
 * @spec-handoff
 * @interface Session.list(input?: { archived?: boolean }): Effect<Info[]>
 * @behavior
 *   - By default (no `archived` flag): EXCLUDE sessions whose `time_archived` is non-null
 *   - When `archived: true` is passed: INCLUDE archived sessions in results
 *   - The LIMIT window is counted AFTER the archived filter, so archived rows never
 *     consume LIMIT slots that belong to active (unarchived) sessions
 * @edge-cases
 *   - `ListInput` at session.ts:291-300 currently has no `archived` field — must be added
 *   - `listByProject` at session.ts:995-1048 has no archived filter — must mirror the
 *     `isNull(SessionTable.time_archived)` guard already present in `listGlobal` (line 604)
 *   - Key regression (#24850): when archived sessions have a more recent `time_updated` than
 *     active sessions, they appear first in the ORDER BY DESC window and consume LIMIT slots,
 *     pushing active sessions past the cutoff — unarchived sessions vanish from the sidebar
 * @see ../../src/session/session.ts (listByProject, ListInput, listGlobal)
 */
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Session as SessionNs } from "@/session/session"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Storage } from "@/storage/storage"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"

const layer = Layer.mergeAll(
  Database.defaultLayer,
  SessionNs.layer.pipe(
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(SessionProjector.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
    Layer.provide(BackgroundJob.defaultLayer),
  ),
)

const it = testEffect(layer)

const withSession = (input?: Parameters<SessionNs.Interface["create"]>[0]) =>
  Effect.acquireRelease(SessionNs.use.create(input), (created) =>
    SessionNs.Service.use((session) => session.remove(created.id).pipe(Effect.ignore)),
  )

afterEach(async () => {
  await disposeAllInstances()
})

describe("session.list archived filter (regression #24850)", () => {
  it.instance(
    "excludes archived sessions by default",
    () =>
      Effect.gen(function* () {
        const active = yield* withSession({ title: "active-session" })
        const archived = yield* withSession({ title: "archived-session" })

        yield* SessionNs.Service.use((session) =>
          session.setArchived({ sessionID: archived.id, time: Date.now() }),
        )

        const sessions = yield* SessionNs.use.list()
        const ids = sessions.map((s) => s.id)

        // Active session must appear in the default (no-archived-flag) list.
        expect(ids).toContain(active.id)
        // Archived session must NOT appear in the default list — this assertion
        // currently FAILS because listByProject has no archived filter.
        expect(ids).not.toContain(archived.id)
      }),
    { git: true },
  )

  it.instance(
    "includes archived sessions when archived flag is true",
    () =>
      Effect.gen(function* () {
        const active = yield* withSession({ title: "active-session" })
        const archived = yield* withSession({ title: "archived-session" })

        yield* SessionNs.Service.use((session) =>
          session.setArchived({ sessionID: archived.id, time: Date.now() }),
        )

        // Pass archived: true — requires `archived?: boolean` in ListInput (currently absent).
        // The @ts-expect-error below suppresses the missing-property error right now.
        // Once the fix adds `archived` to ListInput, remove the @ts-expect-error line:
        // the type will compile cleanly and both runtime assertions below must hold.
        const sessions = yield* SessionNs.Service.use((session) =>
          session.list({ archived: true }),
        )
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(active.id)
        expect(ids).toContain(archived.id)
      }),
    { git: true },
  )

  it.instance(
    "archived sessions do not consume LIMIT slots intended for active sessions (core #24850 regression)",
    () =>
      Effect.gen(function* () {
        const { db } = yield* Database.Service

        // Create 3 active sessions first (older timestamps).
        const active1 = yield* withSession({ title: "active-1" })
        const active2 = yield* withSession({ title: "active-2" })
        const active3 = yield* withSession({ title: "active-3" })

        // Create 3 archived sessions and give them a time_updated far in the
        // future so they sort ABOVE the active sessions in the DESC window.
        // This is the exact scenario in #24850: a session is archived but its
        // time_updated is more recent, so it crowds out active sessions.
        const archived1 = yield* withSession({ title: "archived-1" })
        const archived2 = yield* withSession({ title: "archived-2" })
        const archived3 = yield* withSession({ title: "archived-3" })

        const futureTs = Date.now() + 1_000_000

        // Stamp the archived rows with a future time_updated so they rank first.
        for (const s of [archived1, archived2, archived3]) {
          yield* db
            .update(SessionTable)
            .set({ time_updated: futureTs })
            .where(eq(SessionTable.id, s.id))
            .run()
            .pipe(Effect.orDie)
        }

        yield* SessionNs.Service.use((session) =>
          session.setArchived({ sessionID: archived1.id, time: Date.now() }),
        )
        yield* SessionNs.Service.use((session) =>
          session.setArchived({ sessionID: archived2.id, time: Date.now() }),
        )
        yield* SessionNs.Service.use((session) =>
          session.setArchived({ sessionID: archived3.id, time: Date.now() }),
        )

        // Request exactly 3 results. Without the archived filter in listByProject,
        // the query returns the 3 archived rows (highest time_updated) and the 3
        // active sessions fall past the LIMIT cutoff — they never appear.
        const sessions = yield* SessionNs.Service.use((session) => session.list({ limit: 3 }))
        const ids = sessions.map((s) => s.id)

        // All 3 active sessions must be present within the limit=3 window.
        // Currently FAILS: archived rows eat all 3 slots.
        expect(ids).toContain(active1.id)
        expect(ids).toContain(active2.id)
        expect(ids).toContain(active3.id)

        // Archived sessions must be absent from the default (no-flag) list.
        expect(ids).not.toContain(archived1.id)
        expect(ids).not.toContain(archived2.id)
        expect(ids).not.toContain(archived3.id)
      }),
    { git: true },
  )
})
