import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const SessionsResponse = Schema.Struct({ data: Schema.Array(Schema.toEncoded(Session.Info)) })

const setup = Effect.gen(function* () {
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  return (path: string, body?: unknown, status = 200, method = body === undefined ? "GET" : "POST") =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
      expect(response.status).toBe(status)
      const json: unknown = response.status === 204 ? undefined : await response.json()
      return json
    })
})

for (const action of ["commit", "clear"]) {
  it.live(`preserves imported undo through ${action} without source workspace snapshots`, () =>
    Effect.gen(function* () {
      const request = yield* setup
      const template = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", {}))
      const id = Session.ID.create()
      const imported = Schema.decodeUnknownSync(SessionResponse)(
        yield* request("/api/experimental/session/import", {
          info: { ...template.data, id, revert: { messageID: "msg_undone", snapshot: "source-snapshot", files: [] } },
          messages: [
            { id: "msg_keep", type: "user", text: "Keep", time: { created: 1 } },
            { id: "msg_undone", type: "user", text: "Undo", time: { created: 2 } },
          ],
        }),
      )
      expect(imported.data.revert).toEqual({ messageID: "msg_undone" })
      expect(Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${id}`)).data.revert).toEqual({
        messageID: "msg_undone",
      })
      expect(yield* request(`/api/session/${id}/message?order=asc`)).toMatchObject({
        data: [{ text: "Keep" }, { text: "Undo" }],
      })

      if (action === "commit") yield* request(`/api/session/${id}/revert/commit`, {}, 204)
      if (action === "clear") yield* request(`/api/session/${id}/revert`, undefined, 204, "DELETE")

      expect(yield* request(`/api/session/${id}/message?order=asc`)).toMatchObject({
        data: action === "commit" ? [{ text: "Keep" }] : [{ text: "Keep" }, { text: "Undo" }],
      })
      expect(
        Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${id}`)).data.revert,
      ).toBeUndefined()
    }).pipe(Effect.scoped),
  )
}

it.live("rejects an imported undo boundary missing from the transcript", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const template = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", {}))
    const id = Session.ID.create()
    expect(
      yield* request(
        "/api/experimental/session/import",
        {
          info: { ...template.data, id, revert: { messageID: "msg_missing" } },
          messages: [],
        },
        404,
      ),
    ).toMatchObject({ _tag: "MessageNotFoundError", sessionID: id, messageID: "msg_missing" })
    yield* request(`/api/session/${id}`, undefined, 404)
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
