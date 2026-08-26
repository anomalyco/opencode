import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { QualityGate } from "@opencode-ai/core/harness/quality-gate"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionTodo.node, QualityGate.node])),
)

const sessionID = SessionV2.ID.make("ses_quality_gate_test")
const messageID = "msg_quality_gate_test" as never
const partID = "prt_quality_gate_test" as never

const setup = Effect.gen(function* () {
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
      slug: "quality-gate",
      directory: "/project",
      title: "quality-gate",
      version: "test",
      metadata: { keep: true },
    })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(MessageTable)
    .values({
      id: messageID,
      session_id: sessionID,
      data: { id: messageID, type: "system", time: { created: Date.now() }, text: "test" } as never,
    })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(PartTable)
    .values({
      id: partID,
      message_id: messageID,
      session_id: sessionID,
      data: {
        type: "tool",
        tool: "bash",
        state: { status: "completed", input: { command: "bun test" } },
      } as never,
    })
    .run()
    .pipe(Effect.orDie)
})

describe("QualityGate", () => {
  it.effect("evaluates execution evidence and persists the result in session metadata", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      yield* todos.update({
        sessionID,
        todos: [{ content: "Run tests", status: "completed", priority: "high" }],
      })

      const gate = yield* QualityGate.Service
      const result = yield* gate.evaluateSession(sessionID)

      expect(result).toMatchObject({
        passed: true,
        score: 5,
        completedTodos: 1,
        totalTodos: 1,
        failedTools: [],
        verificationCommands: ["bun test"],
        passedVerificationCommands: ["bun test"],
        failedVerificationCommands: [],
        issues: [],
      })

      const { db } = yield* Database.Service
      const session = yield* db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(session?.metadata).toMatchObject({ keep: true, qualityGate: result })

      yield* db
        .insert(PartTable)
        .values({
          id: "prt_quality_gate_failed" as never,
          message_id: messageID,
          session_id: sessionID,
          data: {
            type: "tool",
            tool: "bash",
            state: { status: "error", input: { command: "unrelated command" }, metadata: { exit: 1 } },
          } as never,
        })
        .run()
        .pipe(Effect.orDie)

      const failedResult = yield* gate.evaluateSession(sessionID)
      expect(failedResult.passed).toBe(false)
      const failedSession = yield* db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(failedSession?.metadata).toMatchObject({ keep: true, qualityGate: failedResult })
    }),
  )

  it.effect("updates metadata correctly when initial metadata is null in database", () =>
    Effect.gen(function* () {
      const nullSessionID = SessionV2.ID.make("ses_null_meta_test")
      const nullMessageID = "msg_null_meta_test" as never
      const nullPartID = "prt_null_meta_test" as never
      const { db } = yield* Database.Service

      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: nullSessionID,
          project_id: Project.ID.global,
          slug: "null-meta",
          directory: "/project",
          title: "null-meta",
          version: "test",
          metadata: null as never,
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(MessageTable)
        .values({
          id: nullMessageID,
          session_id: nullSessionID,
          data: { id: nullMessageID, type: "system", time: { created: Date.now() }, text: "test" } as never,
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(PartTable)
        .values({
          id: nullPartID,
          message_id: nullMessageID,
          session_id: nullSessionID,
          data: {
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "bun test" } },
          } as never,
        })
        .run()
        .pipe(Effect.orDie)

      // Verify DB starts with null metadata
      const initialSession = yield* db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, nullSessionID))
        .get()
        .pipe(Effect.orDie)
      expect(initialSession?.metadata).toBeNull()

      // Evaluate session
      const gate = yield* QualityGate.Service
      const result = yield* gate.evaluateSession(nullSessionID)

      // Verify metadata is now populated with only qualityGate
      const updatedSession = yield* db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, nullSessionID))
        .get()
        .pipe(Effect.orDie)
      expect(updatedSession?.metadata).toEqual({ qualityGate: result })
    }),
  )
})
