import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Event } from "@opencode-ai/schema/event"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node]), [
    [Bus.node, Bus.configured({ persist: true })],
  ]),
)

const seedSessions = (rows: { id: string; updated: number }[]) =>
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
})
