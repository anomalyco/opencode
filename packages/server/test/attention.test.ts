import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("lists pending permissions and questions of a location's sessions together", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const directory = (yield* tmpdirScoped()).path
    const location = `location[directory]=${encodeURIComponent(directory)}`
    const request = <Data = { readonly id: string }>(path: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        return { status: response.status, body: (await response.json()) as { readonly data: Data } }
      })
    const create = (parentID?: string) =>
      request("/api/session", {
        location: { directory },
        parentID,
        permissions: [{ action: "attention.test", resource: "*", effect: "ask" }],
      }).pipe(Effect.map((response) => response.body.data.id))
    const parent = yield* create()
    const child = yield* create(parent)

    const permission = yield* request<{ readonly id: string; readonly effect: string }>(
      `/api/session/${child}/permission`,
      {
        action: "attention.test",
        resources: ["a"],
        source: { type: "tool", messageID: "msg_asking", id: "call_1" },
      },
    )
    expect(permission.body.data.effect).toBe("ask")
    const question = yield* request(`/api/session/${parent}/form`, {
      title: "Questions",
      metadata: { kind: "question", tool: { messageID: "msg_question", id: "call_2" } },
      fields: [{ key: "q0", type: "string" }],
    })
    const form = yield* request(`/api/session/${parent}/form`, {
      title: "Pick one",
      fields: [{ key: "answer", type: "string" }],
    })
    // An elicitation no Session owns is not Session attention.
    yield* request(`/api/session/global/form?${location}`, {
      title: "Sign in",
      fields: [{ key: "token", type: "string" }],
    })

    const attention = yield* request<unknown>(`/api/experimental/attention?${location}`)
    expect(attention.status).toBe(200)
    expect(attention.body.data).toEqual([
      { type: "permission", sessionID: child, requestID: permission.body.data.id, messageID: "msg_asking" },
      { type: "question", sessionID: parent, requestID: question.body.data.id, messageID: "msg_question" },
      { type: "question", sessionID: parent, requestID: form.body.data.id },
    ])
  }).pipe(Effect.scoped),
)
