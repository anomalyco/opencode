import { afterEach, describe, expect } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Todo } from "../../src/session/todo"
import { Session } from "../../src/session/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"
import { MessageTable, PartTable, SessionTable, TodoTable } from "../../src/session/session.sql"
import { BackupPaths } from "../../src/server/routes/instance/httpapi/groups/backup"
import { Server } from "../../src/server/server"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

const originalHttpApi = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const it = testEffect(Layer.mergeAll(NodeServices.layer, Session.defaultLayer, Todo.defaultLayer))

function request(path: string, directory: string, init: RequestInit = {}, httpApi = true) {
  return Effect.promise(() => {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = httpApi
    const headers = new Headers(init.headers)
    headers.set("x-opencode-directory", directory)
    return Promise.resolve(Server.Default().app.request(path, { ...init, headers }))
  })
}

function body(value: unknown) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  } satisfies RequestInit
}

function messageData(role: "user" | "assistant", time: number) {
  return {
    role,
    agent: "default",
    model: {
      providerID: "openai",
      modelID: "gpt-4",
    },
    time: {
      created: time,
    },
  }
}

function partData(text: string) {
  return {
    type: "text" as const,
    text,
  }
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = originalHttpApi
  await disposeAllInstances()
  await resetDatabase()
})

describe("backup routes", () => {
  for (const httpApi of [false, true]) {
    const label = httpApi ? "HttpApi" : "Hono"

    it.live(`lists, exports, and imports sessions via ${label}`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const sessionInfo = yield* Session.Service.use((session) => session.create({ title: "Backup session" })).pipe(
          provideInstance(dir),
        )
        const time = Date.now()

        yield* Effect.sync(() =>
          Database.transaction((db) => {
            db.insert(MessageTable)
              .values([
                {
                  id: MessageID.make("msg_backup_test"),
                  session_id: sessionInfo.id,
                  time_created: time,
                  data: messageData("user", time),
                },
              ])
              .run()
            db.insert(PartTable)
              .values([
                {
                  id: PartID.make("prt_backup_test"),
                  message_id: MessageID.make("msg_backup_test"),
                  session_id: sessionInfo.id,
                  data: partData("hello from backup"),
                },
              ])
              .run()
          }),
        )

        yield* Todo.Service.use((todo) =>
          todo.update({
            sessionID: sessionInfo.id,
            todos: [
              {
                content: "ship backup",
                status: "pending",
                priority: "high",
              },
            ],
          }),
        ).pipe(provideInstance(dir))

        const listed = yield* request(BackupPaths.list, dir, { method: "POST" }, httpApi)
        expect(listed.status).toBe(200)
        expect((yield* Effect.promise(() => listed.json())) as Session.Info[]).toMatchObject([
          {
            id: sessionInfo.id,
            title: "Backup session",
          },
        ])

        const exported = yield* request(BackupPaths.export, dir, body({ sessionID: sessionInfo.id }), httpApi)
        expect(exported.status).toBe(200)
        const payload = yield* Effect.promise(() => exported.json())
        expect((payload as { info: Session.Info }).info.id).toBe(sessionInfo.id)

        yield* Effect.sync(() =>
          Database.transaction((db) => {
            db.update(SessionTable).set({ title: "stale" }).where(eq(SessionTable.id, sessionInfo.id)).run()
            db.delete(PartTable).where(eq(PartTable.session_id, sessionInfo.id)).run()
            db.delete(MessageTable).where(eq(MessageTable.session_id, sessionInfo.id)).run()
            db.delete(TodoTable).where(eq(TodoTable.session_id, sessionInfo.id)).run()
            db.insert(MessageTable)
              .values([
                {
                  id: MessageID.make("msg_stale"),
                  session_id: sessionInfo.id,
                  time_created: time + 1,
                  data: messageData("assistant", time + 1),
                },
              ])
              .run()
            db.insert(PartTable)
              .values([
                {
                  id: PartID.make("prt_stale"),
                  message_id: MessageID.make("msg_stale"),
                  session_id: sessionInfo.id,
                  data: partData("stale"),
                },
              ])
              .run()
            db.insert(TodoTable)
              .values({
                session_id: sessionInfo.id,
                content: "stale",
                status: "cancelled",
                priority: "low",
                position: 0,
              })
              .run()
          }),
        )

        const imported = yield* request(BackupPaths.import, dir, body({ payload }), httpApi)
        expect(imported.status).toBe(200)
        const importedBody = (yield* Effect.promise(() => imported.json())) as { sessionID: string }
        expect(importedBody.sessionID).not.toBe(sessionInfo.id)
        const importedID = SessionID.make(importedBody.sessionID)

        const restoredSession = yield* Session.Service.use((session) => session.get(importedID)).pipe(provideInstance(dir))
        const restoredMessages = yield* Session.Service.use((session) =>
          session.messages({ sessionID: importedID }),
        ).pipe(provideInstance(dir))
        const restoredTodos = yield* Todo.Service.use((todo) => todo.get(importedID)).pipe(provideInstance(dir))

        expect(restoredSession.title).toBe("Backup session")
        expect(restoredMessages).toHaveLength(1)
        expect(restoredMessages[0]?.parts).toMatchObject([
          {
            type: "text",
            text: "hello from backup",
          },
        ])
        expect(restoredTodos).toEqual([
          {
            content: "ship backup",
            status: "pending",
            priority: "high",
          },
        ])
        expect((yield* Session.Service.use((session) => session.get(sessionInfo.id)).pipe(provideInstance(dir))).title).toBe("stale")
      }),
    )
  }
})
