import { describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { KnowledgeGuidance } from "@opencode-ai/core/knowledge/guidance"
import { KnowledgeRetrieval } from "@opencode-ai/core/knowledge/retrieval"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SystemContext } from "@opencode-ai/core/system-context"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"

const FLAG = "OPENCODE_EXPERIMENTAL_KNOWLEDGE"

const capturedQueries: string[] = []
let stubDocs: ReadonlyArray<KnowledgeRetrieval.Doc> = []
const retrievalMock = Layer.mock(KnowledgeRetrieval.Service, {
  search: (query: string, topK: number) =>
    Effect.succeed(capturedQueries.push(query) > 0 ? stubDocs.slice(0, topK) : stubDocs.slice(0, topK)),
})

const layer = AppNodeBuilder.build(LayerNode.group([Database.node, KnowledgeGuidance.node]), [
  [KnowledgeRetrieval.node, retrievalMock],
])
const it = testEffect(layer)

const withFlag = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.sync(() => process.env[FLAG]), (previous) =>
    Effect.suspend(() => {
      if (value === undefined) delete process.env[FLAG]
      else process.env[FLAG] = value
      return effect
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (previous === undefined) delete process.env[FLAG]
          else process.env[FLAG] = previous
        }),
      ),
    ),
  )

const now = Date.now()
const encodePrompt = Schema.encodeSync(Prompt)

const insertProject = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: "global" as any, worktree: "/project" as any, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const insertSession = (sessionID: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* insertProject
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID as any,
        project_id: "global" as any,
        slug: sessionID,
        directory: "/project" as any,
        title: "knowledge guidance test",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

let admittedSeq = 1000
const insertPendingInput = (sessionID: string, text: string, delivery: "steer" | "queue", promoted = false) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const seq = (admittedSeq += 1)
    yield* db
      .insert(SessionInputTable)
      .values({
        id: SessionMessage.ID.create() as any,
        session_id: sessionID as any,
        prompt: encodePrompt(Prompt.make({ text })) as any,
        delivery,
        admitted_seq: seq,
        ...(promoted ? { promoted_seq: seq } : {}),
      })
      .run()
      .pipe(Effect.orDie)
  })

const insertUserMessage = (sessionID: string, text: string, seq: number) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionMessageTable)
      .values({
        id: SessionMessage.ID.create() as any,
        session_id: sessionID as any,
        type: "user" as any,
        seq,
        time_created: now,
        time_updated: now,
        data: { text, files: [], agents: [], time: { created: now } } as any,
      })
      .run()
      .pipe(Effect.orDie)
  })

const doc = (title: string): KnowledgeRetrieval.Doc => ({ title, section: "test", content: "content", similarity: 0.9 })

const freshSession = () => SessionV2.ID.make(`ses_knowledge_${Date.now()}_${Math.floor(Math.random() * 1e9)}`) as string

const baselineOf = (sessionID: string) =>
  Effect.gen(function* () {
    const guidance = yield* KnowledgeGuidance.Service
    return yield* guidance.load(sessionID as any).pipe(Effect.flatMap(SystemContext.initialize))
  })

describe("KnowledgeGuidance first-turn retrieval", () => {
  it.effect("retrieves from pending steer on the first turn without history", () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const sessionID = freshSession()
        yield* insertSession(sessionID)
        capturedQueries.length = 0
        stubDocs = [doc("pending-steer-doc")]
        yield* insertPendingInput(sessionID, "explain session runner architecture and prompt admission", "steer")

        const generation = yield* baselineOf(sessionID)

        expect(capturedQueries).toEqual(["explain session runner architecture and prompt admission"])
        expect(generation.baseline).toContain("<retrieved_knowledge>")
        expect(generation.baseline).toContain("pending-steer-doc")
      }),
    ),
  )

  it.effect("prefers pending steer over pending queue", () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const sessionID = freshSession()
        yield* insertSession(sessionID)
        capturedQueries.length = 0
        stubDocs = [doc("steer-doc")]
        yield* insertPendingInput(sessionID, "queued older question about the database layer schema", "queue")
        yield* insertPendingInput(sessionID, "explain session runner architecture and prompt admission", "steer")

        yield* baselineOf(sessionID)

        expect(capturedQueries).toEqual(["explain session runner architecture and prompt admission"])
      }),
    ),
  )

  it.effect("falls back to pending queue when no steer is pending", () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const sessionID = freshSession()
        yield* insertSession(sessionID)
        capturedQueries.length = 0
        stubDocs = [doc("queue-doc")]
        yield* insertPendingInput(sessionID, "queued question about the database layer schema here", "queue")

        const generation = yield* baselineOf(sessionID)

        expect(capturedQueries).toEqual(["queued question about the database layer schema here"])
        expect(generation.baseline).toContain("<retrieved_knowledge>")
      }),
    ),
  )

  it.effect("falls back to history when nothing is pending", () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const sessionID = freshSession()
        yield* insertSession(sessionID)
        capturedQueries.length = 0
        stubDocs = [doc("history-doc")]
        yield* insertUserMessage(sessionID, "explain session runner architecture and prompt admission", 1)

        const generation = yield* baselineOf(sessionID)

        expect(capturedQueries).toEqual(["explain session runner architecture and prompt admission"])
        expect(generation.baseline).toContain("<retrieved_knowledge>")
      }),
    ),
  )

  it.effect("ignores promoted inputs and uses history", () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const sessionID = freshSession()
        yield* insertSession(sessionID)
        capturedQueries.length = 0
        stubDocs = [doc("history-doc")]
        yield* insertPendingInput(sessionID, "already promoted old steer text that should be ignored", "steer", true)
        yield* insertUserMessage(sessionID, "explain session runner architecture and prompt admission", 2)

        yield* baselineOf(sessionID)

        expect(capturedQueries).toEqual(["explain session runner architecture and prompt admission"])
      }),
    ),
  )

  it.effect("returns empty for a short pending query", () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const sessionID = freshSession()
        yield* insertSession(sessionID)
        capturedQueries.length = 0
        stubDocs = [doc("unused")]
        yield* insertPendingInput(sessionID, "fix it", "steer")

        const generation = yield* baselineOf(sessionID)

        expect(capturedQueries).toEqual([])
        expect(generation.baseline).toBe("")
      }),
    ),
  )

  it.effect("returns empty when the flag is off even with pending input", () =>
    withFlag(
      undefined,
      Effect.gen(function* () {
        const sessionID = freshSession()
        yield* insertSession(sessionID)
        capturedQueries.length = 0
        stubDocs = [doc("unused")]
        yield* insertPendingInput(sessionID, "explain session runner architecture and prompt admission", "steer")

        const generation = yield* baselineOf(sessionID)

        expect(capturedQueries).toEqual([])
        expect(generation.baseline).toBe("")
      }),
    ),
  )
})
