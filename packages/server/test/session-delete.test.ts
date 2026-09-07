import fs from "node:fs/promises"
import { expect } from "bun:test"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Schema } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("deletes a session after its directory is removed", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    yield* Effect.promise(async () => {
      const created = await handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ location: { directory: tmp.path } }),
        }),
      )
      expect(created.status).toBe(200)
      const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
        await created.json(),
      )
      await fs.rm(tmp.path, { recursive: true })

      const url = `http://opencode.local/api/session/${session.data.id}`
      const removed = await handler(new Request(url, { method: "DELETE" }))
      const read = await handler(new Request(url))
      expect({ removed: removed.status, read: read.status }).toEqual({ removed: 204, read: 404 })
      expect(await read.json()).toMatchObject({ _tag: "SessionNotFoundError", sessionID: session.data.id })
    })
  }).pipe(Effect.scoped),
)
