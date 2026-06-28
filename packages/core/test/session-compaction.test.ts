import { expect, test } from "bun:test"
import { LLMEvent, Model, type LLMRequest } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionV2 } from "@opencode-ai/core/session"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, SessionProjector.defaultLayer))
const model = Model.make({
  id: "summary-model",
  provider: "test",
  route: OpenAIChat.route.with({ limits: { context: 10_000, output: 1_000 } }),
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

it.effect("manual compaction summarizes short context instead of no-op", () =>
  Effect.gen(function* () {
    const requests: LLMRequest[] = []
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const sessionID = SessionV2.ID.make("ses_manual_compaction")
    const userMessage = {
      id: SessionMessage.ID.create(),
      type: "user" as const,
      text: "Manual compaction should include this short conversation.",
      time: { created: DateTime.makeUnsafe(0) },
    }
    const compacted = SessionCompaction.make({
      events,
      llm: {
        stream: (request) => {
          requests.push(request)
          return Stream.make(LLMEvent.textDelta({ id: "summary", text: "manual summary" }))
        },
      },
      config: [],
    })

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
        slug: "manual-compaction",
        directory: "/project",
        title: "Manual compaction",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)

    expect(yield* compacted.compactManual({ sessionID, messages: [userMessage], model })).toBe(true)

    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0]?.messages)).toContain("Manual compaction should include this short conversation.")
    expect(
      yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.type, "compaction"))
        .get()
        .pipe(Effect.orDie)
        .pipe(
          Effect.map((row) =>
            row ? Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }) : row,
          ),
        ),
    ).toMatchObject({ type: "compaction", reason: "manual", summary: "manual summary", recent: "" })
    expect(
      yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([
      { type: EventV2.versionedType(SessionEvent.Compaction.Started.type, 1) },
      { type: EventV2.versionedType(SessionEvent.Compaction.Ended.type, 1) },
    ])
  }),
)
