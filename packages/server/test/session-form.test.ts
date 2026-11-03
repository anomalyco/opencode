import { expect } from "bun:test"
import fs from "fs/promises"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("lists no forms for a Session whose Location is not live, and pending forms once it is", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        return { status: response.status, body: await response.json() }
      })
    const create = (directory: string) =>
      request("/api/session", { location: { directory } }).pipe(
        Effect.map((response) => (response.body as { data: { id: string } }).data.id),
      )

    // A subagent whose worktree was deleted must not boot or 404.
    const deleted = yield* tmpdirScoped()
    const orphan = yield* create(deleted.path)
    yield* Effect.promise(() => fs.rm(deleted.path, { recursive: true, force: true }))
    expect(yield* request(`/api/session/${orphan}/form`)).toEqual({ status: 200, body: { data: [] } })

    const directory = yield* tmpdirScoped()
    const live = yield* create(directory.path)
    const created = yield* request(`/api/session/${live}/form`, {
      title: "Pick one",
      fields: [{ key: "answer", type: "string" }],
    })
    expect(created.status).toBe(200)
    expect(yield* request(`/api/session/${live}/form`)).toEqual({
      status: 200,
      body: { data: [(created.body as { data: unknown }).data] },
    })
  }).pipe(Effect.scoped),
)
