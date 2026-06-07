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

const it = testEffect(
  Layer.mergeAll(
    ToolRegistry.defaultLayer,
    Database.defaultLayer,
  ),
)

afterEach(async () => {
  await disposeAllInstances()
})

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

function getTool(id: string) {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const tools = yield* registry.all()
    return tools.find((t) => t.id === id)
  })
}

function seedWithRawSql(opts: {
  sessionTitle: string
  sessionId: string
  text: string
  role?: string
}) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const ctx = yield* InstanceState.context
    const projectID = ctx.project.id
    const now = Date.now()

    yield* db
      .run(
        sql`INSERT OR IGNORE INTO session
          (id, project_id, directory, slug, title, version, time_created, time_updated,
           tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost)
          VALUES (
            ${opts.sessionId}, ${projectID}, ${ctx.directory},
            ${"test-" + opts.sessionId}, ${opts.sessionTitle}, ${"1.0.0"},
            ${now}, ${now}, 0, 0, 0, 0, 0, 0
          )`,
      )
      .pipe(Effect.orDie)

    const messageId = MessageID.ascending()
    const partId = "prt_" + messageId.slice(4)

    yield* db
      .run(
        sql`INSERT OR IGNORE INTO message
          (id, session_id, time_created, time_updated, data)
          VALUES (${messageId}, ${opts.sessionId}, ${now}, ${now}, ${JSON.stringify({ role: opts.role ?? "user" })})`,
      )
      .pipe(Effect.orDie)

    yield* db
      .run(
        sql`INSERT OR IGNORE INTO part
          (id, message_id, session_id, time_created, time_updated, data)
          VALUES (${partId}, ${messageId}, ${opts.sessionId}, ${now}, ${now}, ${JSON.stringify({ type: "text", text: opts.text })})`,
      )
      .pipe(Effect.orDie)
  })
}

describe("session_search", () => {
  it.instance("finds text in session messages via lexical match", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedWithRawSql({
        sessionTitle: "Debugging Retry Logic",
        sessionId,
        text: "We need to fix the retry logic in the HTTP client",
        role: "user",
      })

      const searchTool = yield* getTool("session_search")
      if (!searchTool) throw new Error("session_search tool not found")

      const result = yield* searchTool.execute({ query: "retry", limit: 10 }, mockContext())

      expect(result.metadata.matches).toBeGreaterThanOrEqual(1)
      expect(result.metadata.mode).toBe("lexical")
      expect(result.output).toContain("retry")
    }),
  )

  it.instance("exact match mode matches exact phrase", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedWithRawSql({
        sessionTitle: "Debugging Retry Logic",
        sessionId,
        text: "We need to fix the retry logic in the HTTP client",
      })

      const searchTool = yield* getTool("session_search")
      if (!searchTool) throw new Error("session_search tool not found")

      const result = yield* searchTool.execute({ query: "retry logic", exact: true, limit: 10 }, mockContext())
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("retry logic")
    }),
  )

  it.instance("exact match mode rejects non-matching phrases", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedWithRawSql({
        sessionTitle: "Debugging Retry Logic",
        sessionId,
        text: "We need to fix the retry logic in the HTTP client",
      })

      const searchTool = yield* getTool("session_search")
      if (!searchTool) throw new Error("session_search tool not found")

      const result = yield* searchTool.execute({ query: "retry something", exact: true, limit: 10 }, mockContext())
      expect(result.metadata.matches).toBe(0)
      expect(result.output).toBe("No matching sessions found.")
    }),
  )

  it.instance("returns empty results for nonexistent query", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedWithRawSql({
        sessionTitle: "Debugging Retry Logic",
        sessionId,
        text: "We need to fix the retry logic in the HTTP client",
      })

      const searchTool = yield* getTool("session_search")
      if (!searchTool) throw new Error("session_search tool not found")

      const result = yield* searchTool.execute({ query: "nonexistent", exact: true, limit: 10 }, mockContext())
      expect(result.metadata.matches).toBe(0)
      expect(result.output).toBe("No matching sessions found.")
    }),
  )

  it.instance("respects limit clamping", () =>
    Effect.gen(function* () {
      yield* seedWithRawSql({
        sessionTitle: "Session One",
        sessionId: SessionID.descending(),
        text: "retry logic is important for reliability",
      })
      yield* seedWithRawSql({
        sessionTitle: "Session Two",
        sessionId: SessionID.descending(),
        text: "implementing retry with exponential backoff",
      })
      yield* seedWithRawSql({
        sessionTitle: "Session Three",
        sessionId: SessionID.descending(),
        text: "testing retry strategies for network failures",
      })

      const searchTool = yield* getTool("session_search")
      if (!searchTool) throw new Error("session_search tool not found")

      const result = yield* searchTool.execute({ query: "retry", limit: 2 }, mockContext())
      expect(result.metadata.matches).toBeLessThanOrEqual(2)
    }),
  )

  it.instance("finds match even when title does not contain query", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedWithRawSql({
        sessionTitle: "Debugging",
        sessionId,
        text: "We need to fix the retry logic",
      })

      const searchTool = yield* getTool("session_search")
      if (!searchTool) throw new Error("session_search tool not found")

      const result = yield* searchTool.execute({ query: "retry", limit: 10 }, mockContext())
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("retry logic")
    }),
  )
})

describe("session_search_global", () => {
  it.instance("finds sessions across projects with global search", () =>
    Effect.gen(function* () {
      const sessionId = SessionID.descending()
      yield* seedWithRawSql({
        sessionTitle: "Global Search Test",
        sessionId,
        text: "this session tests cross-project search capability",
      })

      const searchTool = yield* getTool("session_search_global")
      if (!searchTool) throw new Error("session_search_global tool not found")

      const result = yield* searchTool.execute({ query: "cross-project", limit: 10 }, mockContext())
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("cross-project")
      expect(result.output).toContain("Global Search Test")
    }),
  )
})
