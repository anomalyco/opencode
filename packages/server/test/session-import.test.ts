import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const SessionsResponse = Schema.Struct({ data: Schema.Array(Schema.toEncoded(Session.Info)) })
const SessionsWithMessageTimes = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Session.ID,
      experimental: Schema.Struct({
        time: Schema.Struct({
          lastUserMessage: Schema.NullOr(Schema.Number),
          lastAssistantMessage: Schema.NullOr(Schema.Number),
        }),
      }),
    }),
  ),
  cursor: Schema.Struct({ next: Schema.optional(Schema.String) }),
})

const setup = Effect.gen(function* () {
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    fs: { filewatcher: false },
  })
  return (path: string, body?: unknown, status = 200) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
      const json: unknown = await response.json()
      expect(response.status).toBe(status)
      return json
    })
})

it.live("includes the latest user and assistant message times in the session list", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const created = yield* request("/api/session", { title: "Empty" })
    expect(created).not.toHaveProperty("data.experimental")
    const empty = Schema.decodeUnknownSync(SessionResponse)(created)
    expect(yield* request(`/api/session/${empty.data.id}`)).not.toHaveProperty("data.experimental")
    const id = Session.ID.create()
    yield* request("/api/experimental/session/import", {
      info: { ...empty.data, id, title: "With messages" },
      messages: [
        { id: "msg_user_fixture", type: "user", text: "Hello", time: { created: 6_000 } },
        {
          id: "msg_assistant_fixture",
          type: "assistant",
          agent: "build",
          model: { providerID: "fixture", id: "fixture" },
          content: [{ type: "text", text: "Reply" }],
          time: { created: 7_000, completed: 7_001 },
        },
        { id: "msg_user_later", type: "user", text: "Next", time: { created: 3_000 } },
        {
          id: "msg_assistant_tool",
          type: "assistant",
          agent: "build",
          model: { providerID: "fixture", id: "fixture" },
          content: [
            {
              type: "tool",
              id: "call_fixture",
              name: "read",
              state: { status: "completed", input: {}, content: [{ type: "text", text: "Done" }] },
              time: { created: 4_000, completed: 4_001 },
            },
          ],
          time: { created: 4_000, completed: 4_001 },
        },
        { id: "msg_system_fixture", type: "system", text: "Internal", time: { created: 5_000 } },
      ],
    })
    const raw = yield* request("/api/session")
    expect(Schema.decodeUnknownSync(SessionsResponse)(raw).data).toHaveLength(2)
    const page = Schema.decodeUnknownSync(SessionsWithMessageTimes)(raw)
    expect(page.data.find((item) => item.id === id)?.experimental.time).toEqual({
      lastUserMessage: 3_000,
      lastAssistantMessage: 4_000,
    })
    expect(page.data.find((item) => item.id === empty.data.id)?.experimental.time).toEqual({
      lastUserMessage: null,
      lastAssistantMessage: null,
    })
  }).pipe(Effect.scoped),
)

it.live("returns message times across session pages", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const template = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", { title: "Template" }))
    yield* request("/api/session", { title: "Empty" })
    const id = Session.ID.create()
    yield* request("/api/experimental/session/import", {
      info: { ...template.data, id, title: "With user message" },
      messages: [{ id: "msg_page_fixture", type: "user", text: "Hello", time: { created: 1_234 } }],
    })
    const first = Schema.decodeUnknownSync(SessionsWithMessageTimes)(yield* request("/api/session?limit=2&order=asc"))
    expect(first.data).toHaveLength(2)
    if (!first.cursor.next) throw new Error("Expected a next cursor")
    const second = Schema.decodeUnknownSync(SessionsWithMessageTimes)(
      yield* request(`/api/session?limit=2&cursor=${encodeURIComponent(first.cursor.next)}`),
    )
    const rows = [...first.data, ...second.data]
    expect(rows).toHaveLength(3)
    expect(rows.find((item) => item.id === id)?.experimental.time).toEqual({
      lastUserMessage: 1_234,
      lastAssistantMessage: null,
    })
    expect(rows.find((item) => item.id === template.data.id)?.experimental.time).toEqual({
      lastUserMessage: null,
      lastAssistantMessage: null,
    })
  }).pipe(Effect.scoped),
)

it.live("preserves imported parentID through HTTP import, read, and parent filter", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const parent = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", { title: "Parent" }))
    const id = Session.ID.create()
    const imported = Schema.decodeUnknownSync(SessionResponse)(
      yield* request("/api/experimental/session/import", {
        info: { ...parent.data, id, parentID: parent.data.id, title: "Imported child" },
        messages: [],
      }),
    )
    const read = Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${id}`))
    const children = Schema.decodeUnknownSync(SessionsResponse)(
      yield* request(`/api/session?parentID=${parent.data.id}`),
    )
    expect({
      imported: imported.data.parentID,
      read: read.data.parentID,
      children: children.data.map((child) => child.id),
    }).toEqual({ imported: parent.data.id, read: parent.data.id, children: [id] })
  }).pipe(Effect.scoped),
)

it.live("upgrades native data in transcripts exported before v2.1", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const template = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", {}))
    const id = Session.ID.create()
    yield* request("/api/experimental/session/import", {
      info: { ...template.data, id },
      messages: [
        {
          id: "msg_legacy",
          type: "assistant",
          agent: "build",
          model: { providerID: "anthropic", id: "claude" },
          providerState: { finish: "kept" },
          content: [
            { type: "text", text: "Answer", state: { signature: "text" } },
            { type: "reasoning", text: "Thinking", state: { signature: "reasoning" } },
            {
              type: "tool",
              id: "call",
              name: "web_search",
              executed: true,
              providerState: { call: "kept" },
              providerResultState: { result: "kept" },
              state: { status: "completed", input: {}, content: [{ type: "text", text: "Found" }] },
              time: { created: 1, ran: 1, completed: 2 },
            },
          ],
          time: { created: 1, completed: 2 },
        },
        {
          id: "msg_compaction",
          type: "compaction",
          status: "completed",
          reason: "manual",
          summary: "Summary",
          recent: "[User]: kept",
          providerState: { compaction: "kept" },
          time: { created: 3 },
        },
        { id: "msg_moved", type: "location-switched", location: { directory: "/moved" }, time: { created: 4 } },
      ],
    })
    expect(yield* request(`/api/session/${id}/message?order=asc`)).toMatchObject({
      data: [
        {
          id: "msg_legacy",
          native: { finish: "kept" },
          content: [
            { type: "text", native: { signature: "text" } },
            { type: "reasoning", native: { signature: "reasoning" } },
            { type: "tool", native: { call: "kept", result: "kept" } },
          ],
        },
        { id: "msg_compaction", native: { compaction: "kept" }, metadata: { recent: "[User]: kept" } },
        { id: "msg_moved", location: { directory: "/moved" } },
      ],
    })
  }).pipe(Effect.scoped),
)

it.live("rejects an invalid imported message without creating the session", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const template = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", {}))
    const id = Session.ID.create()
    const error = yield* request(
      "/api/experimental/session/import",
      { info: { ...template.data, id }, messages: [{ id: "msg_invalid", type: "assistant" }] },
      400,
    )
    expect(error).toMatchObject({
      _tag: "InvalidRequestError",
      kind: "Payload",
      message: expect.stringContaining(`["messages"][0]`),
    })
    expect(yield* request(`/api/session/${id}`, undefined, 404)).toMatchObject({ _tag: "SessionNotFoundError" })
  }).pipe(Effect.scoped),
)
;["missing", "self"].forEach((parent) => {
  it.live(`rejects a ${parent} parent without creating the imported session`, () =>
    Effect.gen(function* () {
      const request = yield* setup
      const template = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", {}))
      const id = Session.ID.create()
      const parentID = parent === "self" ? id : Session.ID.create()
      const error = yield* request(
        "/api/experimental/session/import",
        { info: { ...template.data, id, parentID }, messages: [] },
        404,
      )
      expect(error).toMatchObject({ _tag: "SessionNotFoundError", sessionID: parentID })
      expect(yield* request(`/api/session/${id}`, undefined, 404)).toMatchObject({
        _tag: "SessionNotFoundError",
        sessionID: id,
      })
    }).pipe(Effect.scoped),
  )
})
