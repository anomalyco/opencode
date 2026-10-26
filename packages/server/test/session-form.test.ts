import { expect } from "bun:test"
import fs from "fs/promises"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("lists pending forms and permissions only from live Locations, per Session and per family", () =>
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
      // The rule keeps a permission request pending instead of allowing it.
      request("/api/session", {
        location: { directory },
        permissions: [{ action: "shell", resource: "*", effect: "ask" }],
      }).pipe(Effect.map((response) => (response.body as { data: { id: string } }).data.id))

    // A subagent whose worktree was deleted must not boot or 404.
    const deleted = yield* tmpdirScoped()
    const orphan = yield* create(deleted.path)
    yield* Effect.promise(() => fs.rm(deleted.path, { recursive: true, force: true }))
    expect(yield* request(`/api/session/${orphan}/form`)).toEqual({ status: 200, body: { data: [] } })
    expect(yield* request(`/api/session/${orphan}/permission`)).toEqual({ status: 200, body: { data: [] } })

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
    const permission = yield* request(`/api/session/${live}/permission`, { action: "shell", resources: ["pwd"] })
    expect(permission.status).toBe(200)
    expect((yield* request(`/api/session/${live}/permission`)).body).toMatchObject({
      data: [{ id: (permission.body as { data: { id: string } }).data.id }],
    })

    // The family read carries the live member's pending requests; a child whose Location is not running adds
    // none and is not started: once its directory is gone, starting it fails instead of reusing a cached Location.
    const idle = yield* tmpdirScoped()
    const imported = yield* request("/api/experimental/session/import", {
      info: { ...(yield* request(`/api/session/${live}`)).body.data, id: "ses_child", parentID: live },
      messages: [],
      location: { directory: idle.path },
    })
    expect(imported.status).toBe(200)
    expect(yield* request("/api/session/ses_child/family")).toMatchObject({
      status: 200,
      body: {
        data: {
          rootID: live,
          sessions: [{ id: live }, { id: "ses_child", parentID: live }],
          permissions: [{ id: (permission.body as { data: { id: string } }).data.id }],
          forms: [(created.body as { data: unknown }).data],
        },
      },
    })
    yield* Effect.promise(() => fs.rm(idle.path, { recursive: true, force: true }))
    expect(
      (yield* request("/api/session/ses_child/form", {
        title: "Pick one",
        fields: [{ key: "answer", type: "string" }],
      })).status,
    ).toBe(404)
    expect((yield* request("/api/session/ses_unknown/family")).status).toBe(404)
  }).pipe(Effect.scoped),
)
