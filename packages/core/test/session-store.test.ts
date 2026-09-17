import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import path from "node:path"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Event } from "@opencode/schema/event"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { Workspace } from "@opencode/schema/workspace"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, FSUtil.node]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)

const seedSessions = (
  rows: { id: string; updated: number; directory?: string; parentID?: Session.ID; workspaceID?: Workspace.ID }[],
) =>
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
          location: {
            directory: row.directory ? AbsolutePath.make(row.directory) : directory,
            workspaceID: row.workspaceID,
          },
          parentID: row.parentID,
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
  for (const [upperName, lowerName] of [
    ["Checkout", "checkout"],
    ["ÉQUIPE", "équipe"],
    ["Σ", "ς"],
  ]) {
    it.effect(
      `matches ${upperName}/${lowerName} historical directory spellings only when the filesystem confirms identity`,
      () =>
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const store = yield* SessionStore.Service
          const tmp = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-directory-case-" })
          const upper = AbsolutePath.make(path.join(tmp, upperName!))
          const lower = AbsolutePath.make(path.join(tmp, lowerName!))
          yield* fs.makeDirectory(upper, { recursive: true })
          yield* fs.makeDirectory(lower, { recursive: true })
          // These are one directory on a normal Windows/macOS filesystem and two
          // on a case-sensitive filesystem. Exercise the actual host's behavior.
          const same = (yield* fs.readDirectory(tmp)).length === 1
          yield* seedSessions([
            { id: "ses_upper", updated: 3, directory: upper },
            { id: "ses_lower", updated: 2, directory: lower },
            { id: "ses_other", updated: 4, directory: path.join(tmp, "Checkout-other") },
          ])
          expect((yield* store.list({ directory: upper })).map((session) => String(session.id))).toEqual(
            same ? ["ses_upper", "ses_lower"] : ["ses_upper"],
          )
          expect((yield* store.list({ directory: lower })).map((session) => String(session.id))).toEqual(
            same ? ["ses_upper", "ses_lower"] : ["ses_lower"],
          )
          expect((yield* store.get(Session.ID.make("ses_lower")))?.location.directory).toBe(lower)
        }),
    )
  }

  it.effect("applies directory identity before page limits and retains search, parent and workspace selectors", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const store = yield* SessionStore.Service
      const tmp = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-directory-pages-" })
      const upper = AbsolutePath.make(path.join(tmp, "Checkout"))
      const lower = AbsolutePath.make(path.join(tmp, "checkout"))
      yield* fs.makeDirectory(upper, { recursive: true })
      yield* fs.makeDirectory(lower, { recursive: true })
      const same = (yield* fs.readDirectory(tmp)).length === 1
      const workspaceID = Workspace.ID.make("wrk_test")
      yield* seedSessions([
        { id: "ses_match_a", updated: 5, directory: upper, workspaceID },
        { id: "ses_match_b", updated: 4, directory: lower, workspaceID },
        { id: "ses_match_c", updated: 3, directory: upper, workspaceID },
        { id: "ses_match_child", updated: 8, directory: lower, workspaceID, parentID: Session.ID.make("ses_match_a") },
        { id: "ses_match_foreign", updated: 7, directory: lower, workspaceID: Workspace.ID.make("wrk_other") },
        { id: "ses_unrelated", updated: 6, directory: lower, workspaceID },
      ])
      const input = { directory: upper, workspaceID, parentID: null, search: "match", limit: 2 } as const
      const first = yield* store.list(input)
      expect(first.map((session) => String(session.id))).toEqual(
        same ? ["ses_match_a", "ses_match_b"] : ["ses_match_a", "ses_match_c"],
      )
      const last = first[first.length - 1]!
      const next = yield* store.list({
        ...input,
        anchor: { id: last.id, time: DateTime.toEpochMillis(last.time.updated), direction: "next" },
      })
      expect(next.map((session) => String(session.id))).toEqual(same ? ["ses_match_c"] : [])
      const previous = yield* store.list({
        ...input,
        anchor: { id: Session.ID.make("ses_match_c"), time: 3, direction: "previous" },
      })
      expect(previous.map((session) => String(session.id))).toEqual(
        same ? ["ses_match_a", "ses_match_b"] : ["ses_match_a"],
      )
    }),
  )

  it.effect("preserves exact missing-directory history without conflating unresolvable case variants", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const store = yield* SessionStore.Service
      const tmp = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-directory-missing-" })
      const upper = AbsolutePath.make(path.join(tmp, "Missing"))
      const lower = AbsolutePath.make(path.join(tmp, "missing"))
      yield* seedSessions([
        { id: "ses_upper", updated: 2, directory: upper },
        { id: "ses_lower", updated: 1, directory: lower },
      ])
      expect((yield* store.list({ directory: upper })).map((session) => String(session.id))).toEqual(["ses_upper"])
      expect((yield* store.list({ directory: lower })).map((session) => String(session.id))).toEqual(["ses_lower"])
    }),
  )

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
