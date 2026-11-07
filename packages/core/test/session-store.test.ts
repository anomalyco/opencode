import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Agent } from "@opencode/schema/agent"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Event } from "@opencode/schema/event"
import { Model } from "@opencode/schema/model"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const partRows = Config.testLayer([
  new Document({
    type: "document",
    info: new Info({ experimental: new ConfigExperimental.Info({ part_rows: true }) }),
  }),
])

const seedSessions = (rows: { id: string; updated: number; parentID?: Session.ID }[]) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const directory = AbsolutePath.make("/project")
    yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: directory, sandboxes: [] }).run()
    yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const sessionID = Session.ID.make(row.id)
        yield* bus.publish(SessionEvent.Created, {
          sessionID,
          projectID: Project.ID.global,
          parentID: row.parentID,
          location: { directory },
          slug: "store-test",
          version: "test",
        })
        yield* bus.replay({
          id: Event.ID.create(),
          created: row.updated,
          aggregateID: sessionID,
          seq: 1,
          type: Bus.versionedType(SessionEvent.Renamed.type, 1),
          data: { sessionID, title: row.id },
        })
      }),
    )
    return bus
  })

describe("SessionStore", () => {
  describe("held reports", () => {
    it.effect("reads unknown and unheld sessions without inserting a missing hold", () =>
      Effect.gen(function* () {
        const sessionID = Session.ID.make("ses_unheld")
        const missing = Session.ID.make("ses_missing")
        yield* seedSessions([{ id: sessionID, updated: 10 }])
        const store = yield* SessionStore.Service
        expect(yield* store.heldReport(sessionID)).toBeUndefined()
        expect(yield* store.heldReport(missing)).toBeUndefined()
        expect(
          yield* store.holdReport(missing, { notificationID: SessionMessage.ID.make("msg_missing"), since: undefined }),
        ).toBeUndefined()
        yield* store.releaseReport(missing)
        expect(yield* store.get(missing)).toBeUndefined()
        expect((yield* store.list()).map((session) => session.id)).toEqual([sessionID])
        expect(yield* store.listHeldChildren()).toEqual([])
      }),
    )

    it.effect("preserves the first bounded hold, clears all fields, and accepts a fresh hold", () =>
      Effect.gen(function* () {
        const sessionID = Session.ID.make("ses_bounded")
        yield* seedSessions([{ id: sessionID, updated: 10 }])
        const store = yield* SessionStore.Service
        const database = yield* Database.Service
        const first = {
          notificationID: SessionMessage.ID.make("msg_first"),
          since: { at: 100, answer: SessionMessage.ID.make("msg_answer") },
        }
        const later = {
          notificationID: SessionMessage.ID.make("msg_later"),
          since: { at: 200, answer: SessionMessage.ID.make("msg_new_answer") },
        }
        expect(yield* store.holdReport(sessionID, first)).toEqual(first)
        expect(yield* store.holdReport(sessionID, later)).toEqual(first)
        expect(yield* store.holdReport(sessionID, { ...later, since: undefined })).toEqual(first)
        expect(yield* store.heldReport(sessionID)).toEqual(first)

        yield* store.releaseReport(sessionID)
        expect(yield* store.heldReport(sessionID)).toBeUndefined()
        expect(
          yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
        ).toMatchObject({ held_report_id: null, held_report_at: null, held_report_answer: null })
        expect(yield* store.holdReport(sessionID, later)).toEqual(later)
        expect(yield* store.heldReport(sessionID)).toEqual(later)
      }),
    )

    it.effect("keeps an unbounded first hold and round-trips a bounded hold without an answer", () =>
      Effect.gen(function* () {
        const sessionID = Session.ID.make("ses_unbounded")
        yield* seedSessions([{ id: sessionID, updated: 10 }])
        const store = yield* SessionStore.Service
        const first = { notificationID: SessionMessage.ID.make("msg_first"), since: undefined }
        const later = {
          notificationID: SessionMessage.ID.make("msg_later"),
          since: { at: 0, answer: undefined },
        }
        expect(yield* store.holdReport(sessionID, first)).toEqual(first)
        expect(yield* store.holdReport(sessionID, later)).toEqual(first)
        expect(yield* store.heldReport(sessionID)).toEqual(first)
        yield* store.releaseReport(sessionID)
        expect(yield* store.holdReport(sessionID, later)).toEqual(later)
        expect(yield* store.heldReport(sessionID)).toEqual(later)
      }),
    )

    it.effect("does not expose an answer cursor without a start timestamp", () =>
      Effect.gen(function* () {
        const parentID = Session.ID.make("ses_parent")
        const sessionID = Session.ID.make("ses_child")
        yield* seedSessions([
          { id: parentID, updated: 20 },
          { id: sessionID, updated: 10, parentID },
        ])
        const database = yield* Database.Service
        const store = yield* SessionStore.Service
        const report = { notificationID: SessionMessage.ID.make("msg_held"), since: undefined }
        yield* database.db
          .update(SessionTable)
          .set({
            held_report_id: report.notificationID,
            held_report_at: null,
            held_report_answer: SessionMessage.ID.make("msg_stray"),
            time_updated: 10,
          })
          .where(eq(SessionTable.id, sessionID))
          .run()
        expect(yield* store.heldReport(sessionID)).toEqual(report)
        expect(yield* store.holdReport(sessionID, report)).toEqual(report)
        expect(yield* store.listHeldChildren()).toEqual([{ sessionID, parentID, report }])
      }),
    )

    it.effect("keeps bookkeeping out of activity timestamps, list ordering and public Info", () =>
      Effect.gen(function* () {
        const sessionID = Session.ID.make("ses_older")
        yield* seedSessions([
          { id: sessionID, updated: 10 },
          { id: "ses_newer", updated: 20 },
        ])
        const store = yield* SessionStore.Service
        const database = yield* Database.Service
        const before = yield* store.list()
        const report = {
          notificationID: SessionMessage.ID.make("msg_held"),
          since: { at: 100, answer: SessionMessage.ID.make("msg_answer") },
        }
        yield* Effect.forEach(
          [store.holdReport(sessionID, report), store.holdReport(sessionID, report), store.releaseReport(sessionID)],
          (operation) =>
            Effect.gen(function* () {
              yield* operation
              expect(
                yield* database.db
                  .select({ updated: SessionTable.time_updated })
                  .from(SessionTable)
                  .where(eq(SessionTable.id, sessionID))
                  .get(),
              ).toEqual({ updated: 10 })
              expect(yield* store.list()).toEqual(before)
              expect(yield* store.get(sessionID)).toEqual(before.find((session) => session.id === sessionID))
              expect(
                Object.keys((yield* store.get(sessionID)) ?? {}).filter((key) => /held|report/i.test(key)),
              ).toEqual([])
            }),
        )
      }),
    )

    it.effect("lists only held children by ID and preserves holds through both claim releases", () =>
      Effect.gen(function* () {
        const parentID = Session.ID.make("ses_parent")
        const firstID = Session.ID.make("ses_a")
        const lastID = Session.ID.make("ses_z")
        yield* seedSessions([
          { id: parentID, updated: 40 },
          { id: lastID, updated: 30, parentID },
          { id: "ses_unheld", updated: 20, parentID },
          { id: firstID, updated: 10, parentID },
        ])
        const store = yield* SessionStore.Service
        const database = yield* Database.Service
        const first = { notificationID: SessionMessage.ID.make("msg_a"), since: undefined }
        const last = {
          notificationID: SessionMessage.ID.make("msg_z"),
          since: { at: 100, answer: SessionMessage.ID.make("msg_answer") },
        }
        yield* store.holdReport(parentID, { notificationID: SessionMessage.ID.make("msg_parent"), since: undefined })
        yield* store.holdReport(lastID, last)
        yield* store.holdReport(firstID, first)
        yield* store.claim(firstID)
        yield* store.countResume(firstID)
        yield* store.release(firstID)
        expect(yield* store.heldReport(firstID)).toEqual(first)
        yield* store.claim(firstID)
        yield* store.claim(lastID)
        yield* store.countResume(lastID)
        yield* store.releaseChildClaims([])
        expect(yield* store.listHeldChildren()).toEqual([
          { sessionID: firstID, parentID, report: first },
          { sessionID: lastID, parentID, report: last },
        ])
        expect(
          yield* database.db
            .select({ claim: SessionTable.time_suspended, attempts: SessionTable.resume_attempts })
            .from(SessionTable)
            .where(eq(SessionTable.id, lastID))
            .get(),
        ).toEqual({ claim: null, attempts: 0 })
      }),
    )
  })

  it.effect("lists by updated time and ID with exclusive two-item pages in either direction", () =>
    Effect.gen(function* () {
      yield* seedSessions([
        { id: "ses_d", updated: 20 },
        { id: "ses_z", updated: 10 },
        { id: "ses_a", updated: 30 },
        { id: "ses_c", updated: 20 },
        { id: "ses_y", updated: 10 },
        { id: "ses_e", updated: 30 },
        { id: "ses_b", updated: 20 },
      ])
      const store = yield* SessionStore.Service
      expect((yield* store.list()).map((session) => String(session.id))).toEqual([
        "ses_e",
        "ses_a",
        "ses_d",
        "ses_c",
        "ses_b",
        "ses_z",
        "ses_y",
      ])
      expect((yield* store.list({ order: "asc" })).map((session) => String(session.id))).toEqual([
        "ses_y",
        "ses_z",
        "ses_b",
        "ses_c",
        "ses_d",
        "ses_a",
        "ses_e",
      ])
      const pages: { order: "asc" | "desc"; direction: "next" | "previous"; ids: string[] }[] = [
        { order: "asc", direction: "next", ids: ["ses_d", "ses_a"] },
        { order: "asc", direction: "previous", ids: ["ses_z", "ses_b"] },
        { order: "desc", direction: "next", ids: ["ses_b", "ses_z"] },
        { order: "desc", direction: "previous", ids: ["ses_a", "ses_d"] },
      ]
      yield* Effect.forEach(pages, (page) =>
        Effect.gen(function* () {
          const sessions = yield* store.list({
            order: page.order,
            limit: 2,
            anchor: { id: Session.ID.make("ses_c"), time: 20, direction: page.direction },
          })
          expect(sessions.map((session) => String(session.id))).toEqual(page.ids)
        }),
      )
    }),
  )

  it.effect("pages messages by durable sequence, not timestamp or ID, and scopes cursor lookup", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_messages")
      const foreignID = Session.ID.make("ses_foreign")
      const bus = yield* seedSessions([
        { id: sessionID, updated: 0 },
        { id: foreignID, updated: 0 },
      ])
      const store = yield* SessionStore.Service
      yield* Effect.forEach(
        [
          { id: "evt_z", created: 300 },
          { id: "evt_b", created: 700 },
          { id: "evt_x", created: 100 },
          { id: "evt_c", created: 400 },
          { id: "evt_w", created: 200 },
          { id: "evt_a", created: 600 },
          { id: "evt_y", created: 500 },
        ],
        (event, index) =>
          bus.replay({
            id: Event.ID.make(event.id),
            created: event.created,
            aggregateID: sessionID,
            seq: index + 2,
            type: Bus.versionedType(SessionEvent.Synthetic.type, 1),
            data: { sessionID, text: event.id },
          }),
      )
      yield* bus.publish(
        SessionEvent.Synthetic,
        { sessionID: foreignID, text: "foreign" },
        {
          id: Event.ID.make("evt_foreign"),
        },
      )
      expect((yield* store.messages({ sessionID })).map((message) => String(message.id))).toEqual([
        "msg_y",
        "msg_a",
        "msg_w",
        "msg_c",
        "msg_x",
        "msg_b",
        "msg_z",
      ])
      expect((yield* store.messages({ sessionID, order: "asc" })).map((message) => String(message.id))).toEqual([
        "msg_z",
        "msg_b",
        "msg_x",
        "msg_c",
        "msg_w",
        "msg_a",
        "msg_y",
      ])
      const pages: { order: "asc" | "desc"; direction: "next" | "previous"; ids: string[] }[] = [
        { order: "asc", direction: "next", ids: ["msg_w", "msg_a"] },
        { order: "asc", direction: "previous", ids: ["msg_b", "msg_x"] },
        { order: "desc", direction: "next", ids: ["msg_x", "msg_b"] },
        { order: "desc", direction: "previous", ids: ["msg_a", "msg_w"] },
      ]
      yield* Effect.forEach(pages, (page) =>
        Effect.gen(function* () {
          const messages = yield* store.messages({
            sessionID,
            order: page.order,
            limit: 2,
            cursor: { id: SessionMessage.ID.make("msg_c"), direction: page.direction },
          })
          expect(messages.map((message) => String(message.id))).toEqual(page.ids)
        }),
      )
      expect(yield* store.messages({ sessionID: Session.ID.make("ses_missing") })).toEqual([])
      expect(
        yield* store.messages({
          sessionID,
          cursor: { id: SessionMessage.ID.make("msg_missing"), direction: "next" },
        }),
      ).toEqual([])
      expect(
        yield* store.messages({
          sessionID,
          order: "asc",
          cursor: { id: SessionMessage.ID.make("msg_foreign"), direction: "next" },
        }),
      ).toEqual([])
    }),
  )

  it.effect("hydrates and settles assistant messages across session_part rows and legacy inline content rows", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_dual_read")
      const bus = yield* seedSessions([{ id: sessionID, updated: 0 }])
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const agent = Agent.ID.make("build")
      const model = { providerID: Provider.ID.make("anthropic"), id: Model.ID.make("claude-sonnet-4-5") }

      const legacyUntouchedID = SessionMessage.ID.make("msg_legacy_untouched")
      const legacyMutatedID = SessionMessage.ID.make("msg_legacy_mutated")
      const splitID = SessionMessage.ID.make("msg_split")

      // 1. Untouched legacy row with inline content and no session_part rows
      yield* database.db
        .insert(SessionMessageTable)
        .values({
          id: legacyUntouchedID,
          session_id: sessionID,
          seq: -2,
          type: "assistant",
          time_created: 10,
          time_updated: 10,
          data: {
            agent,
            model,
            content: [{ type: "text", text: "legacy inline only" }],
            time: { created: 10, completed: 11 },
          },
        })
        .run()

      // 2. Legacy row with inline content that gets mutated via projector and split into session_part
      yield* database.db
        .insert(SessionMessageTable)
        .values({
          id: legacyMutatedID,
          session_id: sessionID,
          seq: -1,
          type: "assistant",
          time_created: 20,
          time_updated: 20,
          data: {
            agent,
            model,
            content: [{ type: "reasoning", text: "legacy reasoning" }],
            time: { created: 20 },
          },
        })
        .run()
      yield* bus.publish(SessionEvent.Text.Started, {
        sessionID,
        assistantMessageID: legacyMutatedID,
        ordinal: 1,
      })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID,
        assistantMessageID: legacyMutatedID,
        ordinal: 1,
        text: "appended into session_part",
      })

      // 3. Fresh step projected directly into session_part
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: splitID,
        agent,
        model,
        started: 30,
      })
      yield* bus.publish(SessionEvent.Reasoning.Started, { sessionID, assistantMessageID: splitID, ordinal: 0 })
      yield* bus.publish(SessionEvent.Reasoning.Ended, {
        sessionID,
        assistantMessageID: splitID,
        ordinal: 0,
        text: "step reasoning",
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID: splitID,
        id: "call_1",
        name: "bash",
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID: splitID,
        id: "call_1",
        input: { command: "ls" },
        executed: true,
      })
      yield* bus.publish(SessionEvent.Tool.Success, {
        sessionID,
        assistantMessageID: splitID,
        id: "call_1",
        content: [{ type: "text", text: "ok" }],
        executed: true,
      })
      yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID: splitID, ordinal: 2 })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID,
        assistantMessageID: splitID,
        ordinal: 2,
        text: "step answer",
      })

      // Verify raw storage split on the mutated legacy row
      const mutatedRaw = yield* database.db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, legacyMutatedID))
        .get()
      expect(mutatedRaw?.data).toMatchObject({ content: [] })
      const mutatedParts = yield* database.db
        .select()
        .from(SessionPartTable)
        .where(eq(SessionPartTable.message_id, legacyMutatedID))
        .orderBy(asc(SessionPartTable.ordinal))
        .all()
      expect(mutatedParts).toHaveLength(2)

      // Settle reads (single-message lookup)
      expect(yield* store.message(legacyUntouchedID)).toMatchObject({
        sessionID,
        message: {
          id: legacyUntouchedID,
          content: [{ type: "text", text: "legacy inline only" }],
        },
      })
      expect(yield* store.message(legacyMutatedID)).toMatchObject({
        sessionID,
        message: {
          id: legacyMutatedID,
          content: [
            { type: "reasoning", text: "legacy reasoning" },
            { type: "text", text: "appended into session_part" },
          ],
        },
      })
      expect(yield* store.message(splitID)).toMatchObject({
        sessionID,
        message: {
          id: splitID,
          content: [
            { type: "reasoning", text: "step reasoning" },
            { type: "tool", id: "call_1", state: { status: "completed" } },
            { type: "text", text: "step answer" },
          ],
        },
      })

      // Hydrate reads (paged store.messages and full SessionHistory.get)
      const hydrated = yield* store.messages({ sessionID, order: "asc" })
      expect(hydrated).toMatchObject([
        { id: legacyUntouchedID, content: [{ type: "text", text: "legacy inline only" }] },
        {
          id: legacyMutatedID,
          content: [
            { type: "reasoning", text: "legacy reasoning" },
            { type: "text", text: "appended into session_part" },
          ],
        },
        {
          id: splitID,
          content: [
            { type: "reasoning", text: "step reasoning" },
            { type: "tool", id: "call_1", state: { status: "completed" } },
            { type: "text", text: "step answer" },
          ],
        },
      ])
      const rows = yield* database.db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.seq))
        .all()
      expect(yield* SessionHistory.decodeMessageRows(database.db, rows)).toEqual(hydrated)
    }).pipe(Effect.provide(partRows)),
  )
})
