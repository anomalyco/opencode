import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))
const sessionsLayer = AppNodeBuilder.build(SessionV2.node, [[SessionExecution.node, SessionExecution.noopLayer]])
const sessionID = SessionV2.ID.make("ses_messages_page")
const created = DateTime.makeUnsafe(0)

const seed = Effect.fnUntraced(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  const events = yield* EventV2.Service
  for (const [index, text] of ["a", "b", "c", "d", "e", "f", "g"].entries()) {
    yield* events.publish(
      SessionEvent.Prompted,
      {
        sessionID,
        messageID: SessionMessage.ID.make(`msg_${text}`),
        timestamp: created,
        prompt: Prompt.make({ text }),
        delivery: "steer",
      },
      { id: EventV2.ID.make(`evt_${index}`) },
    )
  }
})

const texts = (messages: SessionMessage.Message[]) =>
  messages.map((message) => (message.type === "user" ? message.text : message.type))

describe("SessionV2.messagesPage", () => {
  it.effect("returns total and startIndex for edge and index seeks", () =>
    Effect.gen(function* () {
      yield* seed()
      const sessions = yield* SessionV2.Service

      const all = yield* sessions.messagesPage({ sessionID, order: "asc" })
      expect(all.total).toBe(7)
      expect(texts(all.messages)).toEqual(["a", "b", "c", "d", "e", "f", "g"])
      expect(all.startIndex).toBe(0)

      const page = yield* sessions.messagesPage({ sessionID, limit: 3, order: "asc", index: 3 })
      expect(page.total).toBe(7)
      expect(texts(page.messages)).toEqual(["d", "e", "f"])
      expect(page.startIndex).toBe(3)

      const empty = yield* sessions.messagesPage({ sessionID, limit: 3, order: "asc", index: 7 })
      expect(empty).toEqual({ messages: [], total: 7 })

      const newest = yield* sessions.messagesPage({ sessionID, limit: 2, order: "desc", index: 0 })
      expect(texts(newest.messages)).toEqual(["g", "f"])
      expect(newest.startIndex).toBe(0)
    }).pipe(Effect.provide(sessionsLayer)),
  )

  it.effect("centers around a message id and continues with cursors", () =>
    Effect.gen(function* () {
      yield* seed()
      const sessions = yield* SessionV2.Service

      const around = yield* sessions.messagesPage({
        sessionID,
        limit: 3,
        order: "asc",
        around: SessionMessage.ID.make("msg_b"),
      })
      expect(texts(around.messages)).toEqual(["a", "b", "c"])
      expect(around.total).toBe(7)
      expect(around.startIndex).toBe(0)

      const mid = yield* sessions.messagesPage({
        sessionID,
        limit: 3,
        order: "asc",
        around: SessionMessage.ID.make("msg_d"),
      })
      expect(texts(mid.messages)).toEqual(["c", "d", "e"])
      expect(mid.startIndex).toBe(2)

      const next = yield* sessions.messagesPage({
        sessionID,
        limit: 3,
        order: "asc",
        cursor: { id: mid.messages.at(-1)!.id, direction: "next" },
      })
      expect(texts(next.messages)).toEqual(["f", "g"])
      expect(next.startIndex).toBe(5)

      const missing = yield* sessions.messagesPage({
        sessionID,
        limit: 3,
        order: "asc",
        around: SessionMessage.ID.make("msg_missing"),
      })
      expect(missing).toEqual({ messages: [], total: 7 })
    }).pipe(Effect.provide(sessionsLayer)),
  )

  it.effect("messages wrapper still returns the message array", () =>
    Effect.gen(function* () {
      yield* seed()
      const sessions = yield* SessionV2.Service
      expect(texts(yield* sessions.messages({ sessionID, limit: 2, order: "asc", index: 1 }))).toEqual(["b", "c"])
    }).pipe(Effect.provide(sessionsLayer)),
  )
})
