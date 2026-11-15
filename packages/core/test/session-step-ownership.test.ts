import { describe, expect } from "bun:test"
import { and, asc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import {
  SessionMessageTable,
  SessionPendingStepTable,
  SessionQuestionTable,
  SessionTable,
} from "@opencode/core/session/sql"
import { Model } from "@opencode/schema/model"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Form } from "@opencode/schema/form"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const sessionID = Session.ID.make("ses_step_ownership")
const otherSessionID = Session.ID.make("ses_other_ownership")
const assistantMessageID = SessionMessage.ID.make("msg_step_owner")
const otherMessageID = SessionMessage.ID.make("msg_other_owner")
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }

const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
  yield* db.insert(SessionTable).values(
    [sessionID, otherSessionID].map((id) => ({
      id,
      project_id: Project.ID.global,
      slug: "ownership",
      directory: "/project",
      version: "test",
    })),
  )
  const bus = yield* Bus.Service
  const event = yield* bus.publish(SessionEvent.Step.Started, {
    sessionID,
    assistantMessageID,
    agent: Agent.defaultID,
    model,
    started: 100,
  })
  return { db, generation: event.durable.seq }
})

const start = (sessionID: Session.ID, assistantMessageID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return yield* bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.defaultID,
      model,
      started: 200,
    })
  })

describe("Step ownership", () => {
  it.effect("requires each child to reference the exact Session, assistant and generation with no NULL bypass", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      const invalid = [
        [otherSessionID, assistantMessageID, fixture.generation],
        [sessionID, otherMessageID, fixture.generation],
        [sessionID, assistantMessageID, fixture.generation + 1],
        [null, assistantMessageID, fixture.generation],
        [sessionID, null, fixture.generation],
        [sessionID, assistantMessageID, null],
      ] as const
      yield* Effect.forEach(invalid, (owner) =>
        Effect.gen(function* () {
          expect(
            yield* fixture.db
              .run(
                sql`INSERT INTO session_pending_step (session_id, assistant_message_id, generation)
              VALUES (${owner[0]}, ${owner[1]}, ${owner[2]})`,
              )
              .pipe(Effect.exit),
          ).toMatchObject({ _tag: "Failure" })
          expect(
            yield* fixture.db
              .run(
                sql`INSERT INTO session_question (id, session_id, assistant_message_id, generation)
              VALUES ('question', ${owner[0]}, ${owner[1]}, ${owner[2]})`,
              )
              .pipe(Effect.exit),
          ).toMatchObject({ _tag: "Failure" })
        }),
      )
      expect(yield* fixture.db.select().from(SessionPendingStepTable)).toEqual([])
      expect(yield* fixture.db.select().from(SessionQuestionTable)).toEqual([])
      // Questions can outlive the pending Step and reference the message directly.
      yield* fixture.db.insert(SessionQuestionTable).values({
        id: Form.ID.make("frm_owner"),
        session_id: sessionID,
        assistant_message_id: assistantMessageID,
        generation: fixture.generation,
      })
      expect(yield* fixture.db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
    }),
  )

  it.effect("allows one pending Step per Session and independent pending Steps in other Sessions", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      const other = yield* start(sessionID, otherMessageID)
      const independent = yield* start(otherSessionID, SessionMessage.ID.make("msg_independent"))
      yield* fixture.db
        .insert(SessionPendingStepTable)
        .values({ session_id: sessionID, assistant_message_id: assistantMessageID, generation: fixture.generation })
      expect(
        yield* fixture.db
          .insert(SessionPendingStepTable)
          .values({
            session_id: sessionID,
            assistant_message_id: otherMessageID,
            generation: other.durable.seq,
          })
          .pipe(Effect.exit),
      ).toMatchObject({ _tag: "Failure" })
      yield* fixture.db.insert(SessionPendingStepTable).values({
        session_id: otherSessionID,
        assistant_message_id: independent.data.assistantMessageID,
        generation: independent.durable.seq,
      })
      expect(yield* fixture.db.select().from(SessionPendingStepTable)).toHaveLength(2)
    }),
  )

  it.effect(
    "blocks same-owner and different-owner starts while a Step is pending and rolls back their projections",
    () =>
      Effect.gen(function* () {
        const fixture = yield* seed
        yield* fixture.db
          .insert(SessionPendingStepTable)
          .values({ session_id: sessionID, assistant_message_id: assistantMessageID, generation: fixture.generation })
        const before = yield* fixture.db.select().from(SessionMessageTable)
        const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
        yield* Effect.forEach([assistantMessageID, otherMessageID], (id) =>
          Effect.gen(function* () {
            expect(yield* start(sessionID, id).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
            expect(yield* fixture.db.select().from(SessionMessageTable)).toEqual(before)
            expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
          }),
        )
      }),
  )

  it.effect(
    "reuses an unreferenced generation but retained Questions prevent replacement after pending consumption",
    () =>
      Effect.gen(function* () {
        const fixture = yield* seed
        const reused = yield* start(sessionID, assistantMessageID)
        const owner = {
          session_id: sessionID,
          assistant_message_id: assistantMessageID,
          generation: reused.durable.seq,
        }
        yield* fixture.db.insert(SessionPendingStepTable).values(owner)
        yield* fixture.db.insert(SessionQuestionTable).values({ id: Form.ID.make("frm_retained"), ...owner })
        yield* fixture.db.delete(SessionPendingStepTable).where(eq(SessionPendingStepTable.session_id, sessionID))
        const before = yield* fixture.db.select().from(SessionMessageTable)
        expect(yield* start(sessionID, assistantMessageID).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
        expect(yield* fixture.db.select().from(SessionMessageTable)).toEqual(before)
        expect(yield* fixture.db.select().from(SessionQuestionTable)).toEqual([
          { id: Form.ID.make("frm_retained"), ...owner },
        ])
        expect(
          yield* fixture.db
            .update(SessionMessageTable)
            .set({ step_started_seq: null })
            .where(eq(SessionMessageTable.id, assistantMessageID))
            .pipe(Effect.exit),
        ).toMatchObject({ _tag: "Failure" })
        yield* fixture.db.delete(SessionQuestionTable)
        const next = yield* start(sessionID, assistantMessageID)
        expect(next.durable.seq).toBeGreaterThan(reused.durable.seq)
      }),
  )

  it.effect("stamps durable sequence only on the exact assistant owner, including reuse of an older message", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      const second = yield* start(sessionID, otherMessageID)
      const independent = yield* start(otherSessionID, SessionMessage.ID.make("msg_independent"))
      // A historical assistant has no inferred generation, even when its seq happens to match a start.
      yield* fixture.db.run(sql`UPDATE session_message SET step_started_seq = NULL WHERE id = ${otherMessageID}`)
      const reused = yield* start(sessionID, assistantMessageID)
      expect(reused.durable.seq).toBeGreaterThan(fixture.generation)
      expect(
        yield* fixture.db
          .select({ id: SessionMessageTable.id, generation: SessionMessageTable.step_started_seq })
          .from(SessionMessageTable)
          .orderBy(asc(SessionMessageTable.id)),
      ).toEqual([
        { id: independent.data.assistantMessageID, generation: independent.durable.seq },
        { id: otherMessageID, generation: null },
        { id: assistantMessageID, generation: reused.durable.seq },
      ])
      expect(
        yield* fixture.db
          .select()
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.id, assistantMessageID), eq(SessionMessageTable.session_id, sessionID)))
          .get(),
      ).toMatchObject({ seq: fixture.generation })
      expect(second.durable.seq).toBeGreaterThan(fixture.generation)
    }),
  )

  it.effect("rejects a non-assistant target without stamping another assistant", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      yield* fixture.db.insert(SessionMessageTable).values({
        id: otherMessageID,
        session_id: sessionID,
        type: "synthetic",
        seq: 100,
        data: { text: "legacy", time: { created: 0 } },
      })
      const before = yield* fixture.db.select().from(SessionMessageTable)
      expect(yield* start(sessionID, otherMessageID).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
      expect(yield* fixture.db.select().from(SessionMessageTable)).toEqual(before)
    }),
  )
})
