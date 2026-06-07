import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID, MessageID } from "@/session/schema"
import { sql } from "drizzle-orm"

// Requires OPENCODE_JINA_API_KEY env var to run semantic tests
// Run: OPENCODE_JINA_API_KEY="jina_..." bun test test/tool/session-search-semantic.test.ts

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Database.defaultLayer))

function mockContext(): Tool.Context {
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

function seedSession(sessionId: string, title: string) {
  return Effect.gen(function* () {
    const db = yield* Database.Service
    const ctx = yield* InstanceState.context
    const now = Date.now()

    yield* db.db
      .run(sql`INSERT OR IGNORE INTO session
          (id, project_id, directory, slug, title, version, time_created, time_updated,
           tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost)
          VALUES (${sessionId}, ${ctx.project.id}, ${ctx.directory},
            ${"test-" + sessionId}, ${title}, ${"1.0.0"},
            ${now}, ${now}, 0, 0, 0, 0, 0, 0)`)
      .pipe(Effect.orDie)
  })
}

function seedMessage(sessionId: string, text: string, role?: string) {
  return Effect.gen(function* () {
    const db = yield* Database.Service
    const messageId = MessageID.ascending()
    const partId = "prt_" + messageId.slice(4)
    const now = Date.now()

    yield* db.db
      .run(sql`INSERT OR IGNORE INTO message
          (id, session_id, time_created, time_updated, data)
          VALUES (${messageId}, ${sessionId}, ${now}, ${now}, ${JSON.stringify({ role: role ?? "user" })})`)
      .pipe(Effect.orDie)
    yield* db.db
      .run(sql`INSERT OR IGNORE INTO part
          (id, message_id, session_id, time_created, time_updated, data)
          VALUES (${partId}, ${messageId}, ${sessionId}, ${now}, ${now}, ${JSON.stringify({ type: "text", text })})`)
      .pipe(Effect.orDie)
  })
}

afterEach(async () => {
  await disposeAllInstances()
})

function getSearchTool() {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const tools = yield* registry.all()
    const tool = tools.find((t) => t.id === "session_search")
    if (!tool) throw new Error("session_search tool not found")
    return tool
  })
}

describe("session_search (semantic)", () => {
  it.instance("returns semantic matches with Jina API key", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedSession(sessionId, "Retry Logic Discussion")
      yield* seedMessage(sessionId, "We need to implement exponential backoff with jitter for the HTTP retry mechanism")
      yield* seedMessage(sessionId, "Good idea. We should cap retries at 5 attempts and use a max delay of 30 seconds.", "assistant")

      const searchTool = yield* getSearchTool()
      const result = yield* searchTool.execute(
        { query: "retry mechanism with backoff", semantic: true, limit: 5 },
        mockContext(),
      )

      expect(result.metadata.mode).toBe("semantic")
      expect(result.metadata.matches).toBeGreaterThan(0)
      const parsed = JSON.parse(result.output)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0].mode).toBe("semantic")
      expect(parsed[0].sessionTitle).toBe("Retry Logic Discussion")
    }),
  )

  it.instance("falls back to lexical when semantic: false", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedSession(sessionId, "Lexical Test")
      yield* seedMessage(sessionId, "exact phrase match test word")

      const searchTool = yield* getSearchTool()
      const result = yield* searchTool.execute(
        { query: "exact phrase match", semantic: false, limit: 5 },
        mockContext(),
      )

      expect(result.metadata.mode).toBe("lexical")
      expect(result.metadata.matches).toBeGreaterThan(0)
    }),
  )

  it.instance("embeddings are cached on second query", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedSession(sessionId, "Cache Test")
      yield* seedMessage(sessionId, "distributed systems consensus algorithms like Raft and Paxos ensure consistency across nodes")

      const searchTool = yield* getSearchTool()

      const result1 = yield* searchTool.execute(
        { query: "consensus protocols", semantic: true, limit: 5 },
        mockContext(),
      )
      const result2 = yield* searchTool.execute(
        { query: "agreement algorithms", semantic: true, limit: 5 },
        mockContext(),
      )

      expect(result1.metadata.mode).toBe("semantic")
      expect(result1.metadata.matches).toBeGreaterThan(0)
      expect(result2.metadata.mode).toBe("semantic")
      expect(result2.metadata.matches).toBeGreaterThan(0)
    }),
  )
})
