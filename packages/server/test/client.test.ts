import { expect } from "bun:test"
import { Client } from "@opencode/schema/client"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const options = {
  app: { version: "test-version" },
  database: { path: ":memory:" },
  config: { project: false },
  models: { fetch: false },
  fs: { filewatcher: false },
} as const

const List = Schema.Struct({ data: Schema.Array(Client.Info) })
const One = Schema.Struct({ data: Client.Info })

it.live("registers UI clients and 404s activation for an unknown session", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const created = Schema.decodeUnknownSync(One)(
      yield* body(
        handler,
        new Request("http://opencode.local/api/client", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "tui", focused: true }),
        }),
        200,
      ),
    )
    expect(created.data.kind).toBe("tui")
    expect(created.data.focused).toBe(true)

    const listed = Schema.decodeUnknownSync(List)(yield* body(handler, new Request("http://opencode.local/api/client"), 200))
    expect(listed.data.map((item) => item.id)).toEqual([created.data.id])

    const missing = yield* Effect.promise(() =>
      handler(new Request("http://opencode.local/api/session/ses_missing/activate", { method: "POST" })),
    )
    expect(missing.status).toBe(404)
  }),
)

function body(handler: (request: Request) => Promise<Response>, request: Request, status: number) {
  return Effect.promise(() => handler(request)).pipe(
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        expect(response.status).toBe(status)
        return yield* Effect.promise(() => response.json())
      }),
    ),
  )
}
