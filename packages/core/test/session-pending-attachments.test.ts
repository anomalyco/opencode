import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionPending } from "@opencode-ai/core/session/pending"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))

describe("SessionPending attachment bounding", () => {
  it.effect("admits a large attachment without putting base64 on the durable event", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const sessionID = SessionSchema.ID.make("ses_pending_attach")
      const inputID = SessionMessage.ID.create()
      const mega = Buffer.alloc(1024 * 1024, 1).toString("base64")
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "pending-attach",
          directory: "/project",
          title: "Pending attach",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      const admitted = yield* SessionPending.admit(db, events, {
        id: inputID,
        sessionID,
        input: {
          type: "user",
          delivery: "steer",
          data: {
            text: "see file",
            files: [
              {
                data: mega,
                mime: "application/octet-stream",
                source: { type: "uri", uri: "file:///tmp/huge.bin" },
                name: "huge.bin",
              },
            ],
          },
        },
      })

      expect(admitted.type).toBe("user")
      if (admitted.type === "user") expect(admitted.data.files?.[0]?.data).toBe(mega)

      const rows = yield* db
        .select()
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, "session.input.admitted.1")))
        .all()
        .pipe(Effect.orDie)
      expect(rows).toHaveLength(1)
      const eventData = Schema.decodeUnknownSync(SessionEvent.InputAdmitted.data)(rows[0]!.data)
      expect(eventData.payloadHash).toBeDefined()
      const inputType = "user"
      const input = Option.getOrThrowWith(
        Option.liftPredicate(eventData.input, (value): value is Extract<typeof eventData.input, { type: "user" }> =>
          value.type === inputType,
        ),
        () => new Error(`Expected ${inputType} input on admitted event`),
      )
      expect(input.data.files?.[0]?.data).toBe("")
      expect(JSON.stringify(eventData).includes(mega)).toBe(false)

      const pending = yield* SessionPending.list(db, sessionID)
      const pendingRow = Option.getOrThrowWith(
        Option.fromUndefinedOr(pending.find((item) => item.id === inputID)),
        () => new Error(`Expected pending input ${inputID}`),
      )
      const row = Option.getOrThrowWith(
        Option.liftPredicate(pendingRow, (value): value is Extract<(typeof pending)[number], { type: "user" }> =>
          value.type === inputType,
        ),
        () => new Error(`Expected ${inputType} pending input`),
      )
      expect(row.data.files?.[0]?.data).toBe(mega)
    }),
  )

  it.effect("stripAttachmentBytes clears only file data fields", () =>
    Effect.sync(() => {
      const stripped = SessionPending.stripAttachmentBytes({
        type: "user",
        delivery: "steer",
        data: {
          text: "hi",
          files: [
            {
              data: "AAAA",
              mime: "text/plain",
              source: { type: "uri", uri: "file:///tmp/a.txt" },
              name: "a.txt",
            },
          ],
        },
      })
      const inputType = "user"
      const input = Option.getOrThrowWith(
        Option.liftPredicate(stripped, (value): value is Extract<typeof stripped, { type: "user" }> =>
          value.type === inputType,
        ),
        () => new Error(`Expected ${inputType} input`),
      )
      expect(input.data.text).toBe("hi")
      expect(input.data.files?.[0]?.data).toBe("")
      expect(input.data.files?.[0]?.name).toBe("a.txt")
    }),
  )

  it.effect("text-only admits omit payloadHash", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const sessionID = SessionSchema.ID.make("ses_pending_text")
      const inputID = SessionMessage.ID.create()
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "pending-text",
          directory: "/project",
          title: "Pending text",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      yield* SessionPending.admit(db, events, {
        id: inputID,
        sessionID,
        input: {
          type: "user",
          delivery: "steer",
          data: { text: "hello" },
        },
      })

      const rows = yield* db
        .select()
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, "session.input.admitted.1")))
        .all()
        .pipe(Effect.orDie)
      expect(rows).toHaveLength(1)
      const eventData = Schema.decodeUnknownSync(SessionEvent.InputAdmitted.data)(rows[0]!.data)
      expect(eventData.payloadHash).toBeUndefined()
      const inputType = "user"
      const input = Option.getOrThrowWith(
        Option.liftPredicate(eventData.input, (value): value is Extract<typeof eventData.input, { type: "user" }> =>
          value.type === inputType,
        ),
        () => new Error(`Expected ${inputType} input on admitted event`),
      )
      expect(input.data.text).toBe("hello")
    }),
  )
})
