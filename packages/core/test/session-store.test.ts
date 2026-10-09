import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable } from "@opencode/core/session/sql"
import { Event } from "@opencode/schema/event"
import { Project } from "@opencode/schema/project"
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
  it.effect("maps directory parameters through the Drizzle column encoder", () =>
    Effect.gen(function* () {
      yield* seedSessions([])
      const database = yield* Database.Service
      const mapped = yield* database.db.get<{ directory: string }>(
        sql`SELECT ${sql.param(AbsolutePath.make("/project///"), SessionTable.directory)} AS directory`,
      )
      expect(mapped?.directory).toBe("/project")

      if (process.platform === "win32") {
        const drive = yield* database.db.get<{ directory: string }>(
          sql`SELECT ${sql.param("C:\\project\\", SessionTable.directory)} AS directory`,
        )
        expect(drive?.directory).toBe("C:/project")
        const unc = yield* database.db.get<{ directory: string }>(
          sql`SELECT ${sql.param("\\\\server\\share\\folder\\", SessionTable.directory)} AS directory`,
        )
        expect(unc?.directory).toBe("//server/share/folder")
      }
    }),
  )

  it.effect("persists new drive and UNC directories across separator formats", () =>
    Effect.gen(function* () {
      const bus = yield* seedSessions([])
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const cases = [
        { id: "ses_new_drive", written: "C:/project/", stored: "C:/project" },
        { id: "ses_new_unc", written: "//server/share/project/", stored: "//server/share/project" },
        ...(process.platform === "win32"
          ? [
              { id: "ses_new_drive_backslash", written: "C:\\project\\", stored: "C:/project" },
              {
                id: "ses_new_unc_backslash",
                written: "\\\\server\\share\\project\\",
                stored: "//server/share/project",
              },
            ]
          : []),
      ]
      yield* Effect.forEach(cases, (entry) =>
        Effect.gen(function* () {
          yield* bus.publish(SessionEvent.Created, {
            sessionID: Session.ID.make(entry.id),
            projectID: Project.ID.global,
            location: { directory: AbsolutePath.make(entry.written) },
            slug: "store-test",
            version: "test",
          })
          // Inspect the driver value so fromDriver cannot hide an incorrect write.
          const row = yield* database.db.get<{ directory: string }>(
            sql`SELECT directory FROM ${SessionTable} WHERE id = ${entry.id}`,
          )
          expect(row?.directory).toBe(entry.stored)
          const windows = yield* store.list({ directory: AbsolutePath.make(entry.written) })
          expect(windows.map((session) => String(session.id))).toContain(entry.id)
          const slashes = yield* store.list({ directory: AbsolutePath.make(entry.stored + "/") })
          expect(slashes.map((session) => String(session.id))).toContain(entry.id)
        }),
      )
    }),
  )

  it.effect("lists legacy Windows drive and UNC directories without matching descendants", () =>
    Effect.gen(function* () {
      const bus = yield* seedSessions([])
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const cases = [
        { id: "ses_legacy_drive", stored: "C:/project///", directory: "C:/project", child: "C:/project/child" },
        {
          id: "ses_legacy_unc",
          stored: "//server/share/project///",
          directory: "//server/share/project",
          child: "//server/share/project/child",
        },
      ]
      yield* Effect.forEach(cases, (entry) =>
        Effect.gen(function* () {
          yield* bus.publish(SessionEvent.Created, {
            sessionID: Session.ID.make(entry.id),
            projectID: Project.ID.global,
            location: { directory: AbsolutePath.make(entry.directory) },
            slug: "store-test",
            version: "test",
          })
          // This test represents a pre-fix stored row; new-write assertions live separately.
          yield* database.db.run(sql`UPDATE ${SessionTable} SET directory = ${entry.stored} WHERE id = ${entry.id}`)
          const found = yield* store.list({ directory: AbsolutePath.make(entry.directory + "/") })
          expect(found.map((item) => String(item.id))).toContain(entry.id)
          const child = yield* store.list({ directory: AbsolutePath.make(entry.child) })
          expect(child.map((item) => String(item.id))).not.toContain(entry.id)
        }),
      )
    }),
  )

  it.effect("normalizes trailing separators for session writes and lookups", () =>
    Effect.gen(function* () {
      const bus = yield* seedSessions([{ id: "ses_directory", updated: 1 }])
      yield* bus.publish(SessionEvent.Created, {
        sessionID: Session.ID.make("ses_directory_slash"),
        projectID: Project.ID.global,
        location: { directory: AbsolutePath.make("/project/") },
        slug: "store-test",
        version: "test",
      })
      const database = yield* Database.Service
      // Assert the persisted value, not the custom column's fromDriver projection.
      const written = yield* database.db.get<{ directory: string }>(
        sql`SELECT directory FROM ${SessionTable} WHERE id = 'ses_directory_slash'`,
      )
      expect(written?.directory).toBe("/project")

      // Keep the newly written row intact: legacy data must be a separate session.
      yield* bus.publish(SessionEvent.Created, {
        sessionID: Session.ID.make("ses_directory_legacy"),
        projectID: Project.ID.global,
        location: { directory: AbsolutePath.make("/project") },
        slug: "store-test",
        version: "test",
      })
      yield* database.db.run(sql`UPDATE ${SessionTable} SET directory = '/project///' WHERE id = 'ses_directory_legacy'`)
      const store = yield* SessionStore.Service
      const paths = ["/project", "/project/", ...(process.platform === "win32" ? ["/project\\\\"] : [])]
      yield* Effect.forEach(paths, (directory) =>
        Effect.gen(function* () {
          const found = yield* store.list({ directory: AbsolutePath.make(directory) })
          expect(found.map((session) => String(session.id)).sort()).toEqual(["ses_directory", "ses_directory_legacy", "ses_directory_slash"])
        }),
      )
    }),
  )

  it.effect("preserves POSIX, drive and UNC directory roots", () =>
    Effect.gen(function* () {
      const bus = yield* seedSessions([])
      const cases = [
        { id: "ses_posix_root", written: "///", query: "/", expected: "/" },
        { id: "ses_drive_root", written: "C:////", query: "C:/", expected: "C:/" },
        { id: "ses_unc_root", written: "//server/share////", query: "//server/share/", expected: "//server/share/" },
      ]
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      yield* Effect.forEach(cases, (entry) =>
        Effect.gen(function* () {
          yield* bus.publish(SessionEvent.Created, {
            sessionID: Session.ID.make(entry.id),
            projectID: Project.ID.global,
            location: { directory: AbsolutePath.make(entry.written) },
            slug: "store-test",
            version: "test",
          })
          // Check the driver value: fromDriver would mask incorrect Windows separators.
          const row = yield* database.db.get<{ directory: string }>(
            sql`SELECT directory FROM ${SessionTable} WHERE id = ${entry.id}`,
          )
          expect(row?.directory).toBe(entry.expected)
          const found = yield* store.list({ directory: AbsolutePath.make(entry.query) })
          expect(found.map((item) => String(item.id))).toContain(entry.id)
          if (process.platform === "win32" && entry.expected !== "/") {
            const windows = yield* store.list({ directory: AbsolutePath.make(entry.query.replaceAll("/", "\\")) })
            expect(windows.map((item) => String(item.id))).toContain(entry.id)
          }
        }),
      )
      // Empty directory is a valid legacy storage value, not a synonym for the POSIX root.
      yield* bus.publish(SessionEvent.Created, {
        sessionID: Session.ID.make("ses_legacy_empty"),
        projectID: Project.ID.global,
        location: { directory: AbsolutePath.make("/somewhere") },
        slug: "store-test",
        version: "test",
      })
      yield* database.db.run(sql`UPDATE ${SessionTable} SET directory = '' WHERE id = 'ses_legacy_empty'`)
      const root = yield* store.list({ directory: AbsolutePath.make("/") })
      expect(root.map((item) => String(item.id))).toEqual(["ses_posix_root"])
    }),
  )

  it.effect("matches legacy filesystem roots without treating descendants as roots", () =>
    Effect.gen(function* () {
      const bus = yield* seedSessions([])
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const cases = [
        { id: "ses_legacy_posix_root", stored: "////", query: "/", child: "/child" },
        { id: "ses_legacy_drive_root", stored: "C:////", query: "C:/", child: "C:/child" },
        {
          id: "ses_legacy_unc_root",
          stored: "//server/share////",
          query: "//server/share/",
          child: "//server/share/child",
        },
      ]
      yield* Effect.forEach(cases, (entry) =>
        Effect.gen(function* () {
          yield* bus.publish(SessionEvent.Created, {
            sessionID: Session.ID.make(entry.id),
            projectID: Project.ID.global,
            location: { directory: AbsolutePath.make(entry.query) },
            slug: "store-test",
            version: "test",
          })
          // Simulate a legacy row separately from the new-write root coverage.
          yield* database.db.run(sql`UPDATE ${SessionTable} SET directory = ${entry.stored} WHERE id = ${entry.id}`)
          const raw = yield* database.db.get<{ directory: string }>(
            sql`SELECT directory FROM ${SessionTable} WHERE id = ${entry.id}`,
          )
          expect(raw?.directory).toBe(entry.stored)
          const found = yield* store.list({ directory: AbsolutePath.make(entry.query) })
          expect(found.map((session) => String(session.id))).toContain(entry.id)
          const child = yield* store.list({ directory: AbsolutePath.make(entry.child) })
          expect(child.map((session) => String(session.id))).not.toContain(entry.id)
        }),
      )
    }),
  )

  it.effect("keeps POSIX trailing backslashes distinct from path separators", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const bus = yield* seedSessions([{ id: "ses_plain", updated: 1 }])
      yield* bus.publish(SessionEvent.Created, {
        sessionID: Session.ID.make("ses_literal_backslash"),
        projectID: Project.ID.global,
        location: { directory: AbsolutePath.make("/project\\") },
        slug: "store-test",
        version: "test",
      })
      const database = yield* Database.Service
      const raw = yield* database.db.get<{ directory: string }>(
        sql`SELECT directory FROM ${SessionTable} WHERE id = 'ses_literal_backslash'`,
      )
      expect(raw?.directory).toBe("/project\\")
      const store = yield* SessionStore.Service
      const escaped = yield* store.list({ directory: AbsolutePath.make("/project\\/") })
      expect(escaped.map((item) => String(item.id))).toEqual(["ses_literal_backslash"])
      const plain = yield* store.list({ directory: AbsolutePath.make("/project/") })
      expect(plain.map((item) => String(item.id))).toEqual(["ses_plain"])
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
