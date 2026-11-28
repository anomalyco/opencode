import { expect } from "bun:test"
import { rm } from "node:fs/promises"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live("a shell command that cannot start answers 503, a declared status, instead of 500", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, body: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )
    const created = yield* request("/api/session", { location: { directory: tmp.path } })
    const id = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => created.json())).data.id
    // The first command boots the session's Location; removing its directory then makes the next spawn fail.
    expect((yield* request(`/api/session/${id}/shell`, { command: "true" })).status).toBe(204)
    yield* Effect.promise(() => rm(tmp.path, { recursive: true, force: true }))

    const failed = yield* request(`/api/session/${id}/shell`, { command: "true" })
    expect(failed.status).toBe(503)
    expect(yield* Effect.promise(() => failed.json())).toMatchObject({
      _tag: "ServiceUnavailableError",
      service: "shell",
    })
  }).pipe(Effect.scoped),
)
