import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Model } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSearch } from "@opencode/core/session/search"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
import { SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionSearch.node])))

const encode = Schema.encodeSync(SessionMessage.Info)
const encodePart = Schema.encodeSync(SessionMessage.AssistantContent)
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }
const msg = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const ses = (value: string) => Session.ID.make(`ses_${value}`)

const DAY = 86_400_000
const NOW = Date.parse("2026-11-20T12:00:00Z")

const user = (value: string, text: string, created = NOW) =>
  SessionMessage.User.make({ id: msg(value), type: "user", text, time: { created: DateTime.makeUnsafe(created) } })

const assistant = (value: string, content: SessionMessage.AssistantContent[], created = NOW) =>
  SessionMessage.Assistant.make({
    id: msg(value),
    type: "assistant",
    agent: Agent.defaultID,
    model,
    content,
    time: { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created) },
  })

const textPart = (value: string) => SessionMessage.AssistantText.make({ type: "text", text: value })

const toolPart = (id: string, name: string, input: Record<string, unknown>, output: string, isError = false) =>
  SessionMessage.AssistantTool.make({
    type: "tool",
    id,
    name,
    state: isError
      ? SessionMessage.ToolStateError.make({
          status: "error",
          input,
          error: { type: "unknown", message: output },
        })
      : SessionMessage.ToolStateCompleted.make({
          status: "completed",
          input,
          content: [{ type: "text", text: output }],
        }),
    time: { created: DateTime.makeUnsafe(NOW) },
  })

const setup = Effect.gen(function* () {
  yield* TestClock.setTime(NOW)
  const db = (yield* Database.Service).db
  const search = yield* SessionSearch.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)

  const addSession = (input: {
    id: string
    title?: string | null
    directory?: string
    parentID?: string
    created?: number
    updated?: number
  }) =>
    db
      .insert(SessionTable)
      .values({
        id: ses(input.id),
        project_id: Project.ID.global,
        parent_id: input.parentID ? ses(input.parentID) : null,
        slug: input.id,
        directory: input.directory ?? "/project",
        title: input.title === undefined ? null : input.title,
        version: "test",
        time_created: input.created ?? NOW,
        time_updated: input.updated ?? input.created ?? NOW,
      })
      .run()
      .pipe(Effect.orDie)

  const addMessages = (sessionID: string, messages: SessionMessage.Info[], from = 1) =>
    Effect.forEach(messages, (message, index) => {
      const { id: _, type, ...data } = encode(message)
      const created = DateTime.toEpochMillis(message.time.created)
      return db
        .insert(SessionMessageTable)
        .values({
          id: message.id,
          session_id: ses(sessionID),
          type,
          seq: from + index,
          time_created: created,
          time_updated: created,
          data,
        })
        .run()
        .pipe(Effect.orDie)
    })

  const addParts = (sessionID: string, messageID: string, parts: SessionMessage.AssistantContent[]) =>
    db
      .insert(SessionPartTable)
      .values(
        parts.map((part, ordinal) => ({
          message_id: msg(messageID),
          session_id: ses(sessionID),
          ordinal,
          type: part.type,
          call_id: part.type === "tool" ? part.id : null,
          time_created: NOW,
          time_updated: NOW,
          data: encodePart(part),
        })),
      )
      .run()
      .pipe(Effect.orDie)

  const buildIndex = Effect.gen(function* () {
    yield* SessionSearchIndex.ensure(db)
    while (!(yield* SessionSearchIndex.buildChunk(db)).done) {}
  })

  return { db, search, addSession, addMessages, addParts, buildIndex }
})

describe("SessionSearch", () => {
  it.effect("fails with IndexUnavailableError when searching before the index exists, while listing still works", () =>
    Effect.gen(function* () {
      const { search, addSession } = yield* setup
      yield* addSession({ id: "a", title: "Alpha" })

      const listed = yield* search.search()
      expect(listed.sessions?.map((item) => item.sessionID)).toEqual([ses("a")])
      expect(listed.next).toBeNull()

      const failed = yield* search.search({ query: "alpha" }).pipe(Effect.flip)
      expect(failed._tag).toBe("SessionSearch.IndexUnavailableError")
    }),
  )

  it.effect("ranks OR matches across titles and messages, caps 3 hits per session, and handles FTS syntax fallback", () =>
    Effect.gen(function* () {
      const { search, addSession, addMessages, buildIndex } = yield* setup
      yield* addSession({ id: "a", title: "Walrus migration plan" })
      yield* addSession({ id: "b", title: "General notes" })
      yield* addMessages("a", [
        user("a1", "first walrus note"),
        user("a2", "second walrus note"),
        user("a3", "third walrus note"),
        user("a4", "fourth walrus note"),
      ])
      yield* addMessages("b", [
        user("b1", "mentions GLM-5.3 and decodeMessageRow rows once"),
        assistant("b2", [textPart("only walrus here")]),
      ])
      yield* buildIndex

      const ranked = yield* search.search({ query: "walrus migration" })
      expect(ranked.results?.map((r) => r.sessionID)).toEqual([ses("a"), ses("b")])
      expect(ranked.results?.[0]?.matches.length).toBe(3)
      expect(ranked.results?.[0]?.matches[0]).toMatchObject({ type: "title" })
      expect(ranked.results?.[0]?.matches[0]?.messageID).toBeUndefined()

      // Explicit phrase & prefix syntax work.
      const phrase = yield* search.search({ query: '"walrus migration"' })
      expect(phrase.results?.map((r) => r.sessionID)).toEqual([ses("a")])
      const prefix = yield* search.search({ query: "migrat*" })
      expect(prefix.results?.map((r) => r.sessionID)).toEqual([ses("a")])

      // Broken FTS syntax falls back cleanly to plain OR instead of erroring.
      const fallback = yield* search.search({ query: 'GLM-5.3 OR "rows" NEAR(' })
      expect(fallback.results?.map((r) => r.sessionID)).toEqual([ses("b")])

      // Punctuation-only query returns empty without error.
      expect(yield* search.search({ query: "  --  " })).toEqual({ results: [] })
    }),
  )

  it.effect("limits search results by sessions even when one session has many matching messages", () =>
    Effect.gen(function* () {
      const { search, addSession, addMessages, buildIndex } = yield* setup
      yield* addSession({ id: "dense" })
      yield* addSession({ id: "sparse" })
      yield* addMessages("dense", Array.from({ length: 125 }, (_, index) => user(`dense-${index}`, "zephyrmarker")))
      yield* addMessages("sparse", [user("sparse-1", `Notes about zephyrmarker. ${"Background context. ".repeat(100)}`)])
      yield* buildIndex

      const result = yield* search.search({ query: "zephyrmarker" })
      expect(result.results?.map((item) => item.sessionID)).toEqual([ses("dense"), ses("sparse")])
      expect(result.results?.map((item) => item.matches.length)).toEqual([3, 1])

      const first = yield* search.search({ query: "zephyrmarker", limit: 1 })
      expect(first.results?.map((item) => item.sessionID)).toEqual([ses("dense")])
      expect(first.results?.[0]?.matches.length).toBe(3)
    }),
  )

  it.effect("folds accents on query and centers snippets on accented and stemmed matches while preserving original text", () =>
    Effect.gen(function* () {
      const { search, addSession, addMessages, buildIndex } = yield* setup
      const padding = "filler word ".repeat(60)
      yield* addSession({ id: "a", title: "Hóa đơn tháng này" })
      yield* addMessages("a", [
        user("a1", `${padding}Check Łódź Straße and hóa đơn details here.`),
        user("a2", `${padding}The worker runs every evening automatically.`),
      ])
      yield* buildIndex

      const viet = yield* search.search({ query: "hoa don" })
      const msgMatch = viet.results?.[0]?.matches.find((m) => m.messageID === msg("a1"))
      expect(msgMatch?.snippet).toContain("hóa đơn")
      expect(msgMatch?.snippet.startsWith("…")).toBe(true)

      const german = yield* search.search({ query: "strasse" })
      expect(german.results?.[0]?.matches[0]?.snippet).toContain("Straße")

      // Query "running" matches "runs" via Porter stemmer and snippet centers on "runs".
      const stemmed = yield* search.search({ query: "running" })
      expect(stemmed.results?.[0]?.matches[0]?.messageID).toBe(msg("a2"))
      expect(stemmed.results?.[0]?.matches[0]?.snippet).toContain("runs every evening")
    }),
  )

  it.effect("filters by directory prefix, sessionID and subagents, and pages listings", () =>
    Effect.gen(function* () {
      const { search, addSession, addMessages, buildIndex } = yield* setup
      yield* addSession({ id: "old", title: "Old narwhal", directory: "/work/app", created: NOW - 20 * DAY, updated: NOW - 15 * DAY })
      yield* addSession({ id: "sub", title: "Sub narwhal", directory: "/work/app/pkg", created: NOW - 3 * DAY, updated: NOW - 2 * DAY })
      yield* addSession({ id: "other", title: "Other narwhal", directory: "/work/app_2", created: NOW - DAY, updated: NOW - DAY })
      yield* addSession({ id: "child", title: "Child narwhal", directory: "/work/app", parentID: "sub", created: NOW - DAY, updated: NOW })
      yield* addMessages("sub", [user("s1", "narwhal body", NOW - 2 * DAY)])
      yield* buildIndex

      // Listing excludes children by default and matches directory + subdirectory without matching app_2.
      const dirList = yield* search.search({ directory: "/work/app/" })
      expect(dirList.sessions?.map((s) => s.sessionID)).toEqual([ses("sub"), ses("old")])

      // Listing pagination works.
      const page1 = yield* search.search({ limit: 2, offset: 0 })
      expect(page1.sessions?.map((s) => s.sessionID)).toEqual([ses("other"), ses("sub")])
      expect(page1.next).toBe(2)
      const page2 = yield* search.search({ limit: 2, offset: 2 })
      expect(page2.sessions?.map((s) => s.sessionID)).toEqual([ses("old")])
      expect(page2.next).toBeNull()

      // Search includes subagent sessions by default; subagents: false hides them.
      const withChildren = yield* search.search({ query: "narwhal", directory: "/work/app" })
      expect(withChildren.results?.map((r) => r.sessionID).toSorted()).toEqual([ses("child"), ses("old"), ses("sub")])
      const noChildren = yield* search.search({ query: "narwhal", directory: "/work/app", subagents: false })
      expect(noChildren.results?.map((r) => r.sessionID).toSorted()).toEqual([ses("old"), ses("sub")])

      // sessionID restricts to one session (even a child).
      const scoped = yield* search.search({ query: "narwhal", sessionID: ses("child") })
      expect(scoped.results?.map((r) => r.sessionID)).toEqual([ses("child")])
    }),
  )

  it.effect("limits results to one project unless sessionID is set", () =>
    Effect.gen(function* () {
      const { db, search, addSession, buildIndex } = yield* setup
      const other = Project.ID.make("prj_other")
      yield* db
        .insert(ProjectTable)
        .values({ id: other, worktree: AbsolutePath.make("/other"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* addSession({ id: "here", title: "Narwhal here" })
      yield* addSession({ id: "there", title: "Narwhal there", directory: "/other" })
      yield* db.update(SessionTable).set({ project_id: other }).where(eq(SessionTable.id, ses("there"))).run().pipe(Effect.orDie)
      yield* buildIndex

      const scoped = yield* search.search({ query: "narwhal", projectID: Project.ID.global })
      expect(scoped.results?.map((r) => r.sessionID)).toEqual([ses("here")])
      const listed = yield* search.search({ projectID: Project.ID.global })
      expect(listed.sessions?.map((s) => s.sessionID)).toEqual([ses("here")])
      const all = yield* search.search({ query: "narwhal" })
      expect(all.results?.map((r) => r.sessionID).toSorted()).toEqual([ses("here"), ses("there")])
      const direct = yield* search.search({ query: "narwhal", projectID: Project.ID.global, sessionID: ses("there") })
      expect(direct.results?.map((r) => r.sessionID)).toEqual([ses("there")])
    }),
  )

  it.effect("reads windows around messageID, from start/end, across compactions, with cursors and tool detail toggle", () =>
    Effect.gen(function* () {
      const { search, addSession, addMessages, addParts } = yield* setup
      yield* addSession({ id: "a", title: "Deep session" })
      const compaction = SessionMessage.CompactionCompleted.make({
        id: msg("03"),
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "Earlier summary before compaction",
        time: { created: DateTime.makeUnsafe(NOW - 4_000) },
      })
      const sys = SessionMessage.System.make({
        id: msg("04"),
        type: "system",
        text: "Internal system update",
        time: { created: DateTime.makeUnsafe(NOW - 3_000) },
      })
      const idle = SessionMessage.Idle.make({
        id: msg("05"),
        type: "idle",
        outcome: "succeeded",
        time: { created: DateTime.makeUnsafe(NOW - 2_000) },
      })
      yield* addMessages("a", [
        user("01", "before compaction prompt", NOW - 6_000),
        assistant("02", [textPart("before compaction answer")], NOW - 5_000),
        compaction,
        sys,
        idle,
        user("06", "after compaction prompt", NOW - 1_000),
        assistant("07", [], NOW),
      ])
      yield* addParts("a", "07", [
        toolPart("call_1", "read", { path: "src/foo.ts" }, "file body here"),
        toolPart("call_2", "shell", { command: "false" }, "exit code 1", true),
        textPart("answer from part row"),
      ])

      // Reading forward from the start includes pre-compaction messages and skips idle + system by default.
      const startPage = yield* search.read({ sessionID: ses("a"), direction: "after", limit: 2 })
      expect(startPage.session.title).toBe("Deep session")
      expect(startPage.messages.map((m) => m.messageID)).toEqual([msg("01"), msg("02")])
      expect(startPage.older).toBeUndefined()
      expect(startPage.newer).toBe(msg("02"))
      expect(Object.keys(startPage)).toEqual(["session", "newer", "messages"])

      // Passing a cursor back in the same direction never repeats a message.
      const nextPage = yield* search.read({ sessionID: ses("a"), messageID: msg("02"), direction: "after", limit: 2 })
      expect(nextPage.messages.map((m) => m.messageID)).toEqual([msg("03"), msg("06")])
      expect(nextPage.newer).toBe(msg("06"))

      // Around the compaction message, split evenly.
      const middle = yield* search.read({ sessionID: ses("a"), messageID: msg("03"), limit: 3 })
      expect(middle.messages.map((m) => m.messageID)).toEqual([msg("02"), msg("03"), msg("06")])
      expect(middle.older).toBe(msg("02"))
      expect(middle.newer).toBe(msg("06"))
      const earlier = yield* search.read({ sessionID: ses("a"), messageID: msg("02"), direction: "before" })
      expect(earlier.messages.map((m) => m.messageID)).toEqual([msg("01")])
      expect(earlier.older).toBeUndefined()

      // Default read (newest) shows compact one-line tool summaries and part text.
      const latest = yield* search.read({ sessionID: ses("a"), limit: 1 })
      expect(latest.messages).toHaveLength(1)
      expect(latest.messages[0]).toMatchObject({
        messageID: msg("07"),
        type: "assistant",
        text: "answer from part row",
        calls: ['read({"path":"src/foo.ts"})', 'shell({"command":"false"}) → error'],
      })
      expect(latest.older).toBe(msg("07"))
      expect(latest.newer).toBeUndefined()

      // Text comes back whole, and a limit over 50 is clamped instead of rejected.
      expect((yield* search.read({ sessionID: ses("a"), limit: 500 })).messages).toHaveLength(5)

      // full: true expands each tool call's input, output and error, and includes system messages.
      const detailed = yield* search.read({ sessionID: ses("a"), messageID: msg("07"), limit: 5, full: true })
      expect(detailed.messages.map((m) => m.messageID)).toEqual([msg("04"), msg("06"), msg("07")])
      expect(detailed.messages[2]?.calls).toEqual([
        { name: "read", status: "completed", input: '{"path":"src/foo.ts"}', output: "file body here" },
        { name: "shell", status: "error", input: '{"command":"false"}', error: "exit code 1" },
      ])

      // Missing session or message produces typed errors.
      const missingSession = yield* search.read({ sessionID: ses("missing") }).pipe(Effect.flip)
      expect(missingSession._tag).toBe("SessionSearch.SessionNotFoundError")
      const missingMessage = yield* search.read({ sessionID: ses("a"), messageID: msg("missing") }).pipe(Effect.flip)
      expect(missingMessage._tag).toBe("SessionSearch.MessageNotFoundError")
    }),
  )

})
