import { expect } from "bun:test"
import fs from "node:fs/promises"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

/** A server whose base configuration turns the machines flag on or off, and its request helper. */
const server = (machines: boolean) =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("opencode-session-cwd-")).path
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { directory, project: false, content: JSON.stringify({ experimental: { machines } }) },
    })
    const request = (path: string, method: string, body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    const post = (path: string, body: unknown) =>
      request(path, "POST", body).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.json())),
        Effect.map((body) => Schema.decodeUnknownSync(SessionResponse)(body).data),
      )
    return { directory, request, post }
  })

it.live(
  "refuses a cwd without the machines flag, on create and on its own route",
  () =>
    Effect.gen(function* () {
      const { directory, request, post } = yield* server(false)
      const created = yield* post("/api/session", {})
      // A session created without one is unchanged.
      expect(created).not.toHaveProperty("experimental")

      expect((yield* request("/api/session", "POST", { experimental: { cwd: directory } })).status).toBe(403)
      expect((yield* request(`/api/experimental/session/${created.id}/cwd`, "POST", { cwd: directory })).status).toBe(
        403,
      )
    }).pipe(Effect.scoped),
  { timeout: 15_000 },
)

it.live(
  "creates, replaces and clears a session cwd with the machines flag on",
  () =>
    Effect.gen(function* () {
      const { directory, request, post } = yield* server(true)
      const created = yield* post("/api/session", { experimental: { cwd: directory } })
      expect(created.experimental?.cwd).toEqual({ absolute: directory, environment: { id: "local" } })

      const work = `${directory}/work`
      yield* Effect.promise(() => fs.mkdir(work, { recursive: true }))
      const set = yield* post(`/api/experimental/session/${created.id}/cwd`, { cwd: work })
      expect(set.experimental?.cwd).toEqual({ absolute: work, environment: { id: "local" } })

      const cleared = yield* post(`/api/experimental/session/${created.id}/cwd`, { cwd: null })
      expect(cleared).not.toHaveProperty("experimental")

      expect(
        (yield* request(`/api/experimental/session/${created.id}/cwd`, "POST", { cwd: `${directory}/missing` })).status,
      ).toBe(400)
    }).pipe(Effect.scoped),
  { timeout: 15_000 },
)
