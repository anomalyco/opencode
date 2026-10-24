import { $ } from "bun"
import { expect } from "bun:test"
import path from "path"
import { Effect, Schema } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const decodeList = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ data: Schema.Array(Schema.Struct({ title: Schema.String })) })),
)

it.live("treats an empty subpath query param as no subpath at the HTTP boundary", () =>
  Effect.gen(function* () {
    const root = (yield* tmpdirScoped()).path
    const nested = path.join(root, "packages", "tui")

    // An unborn repo resolves to the global project, so the nested session gets a real subpath
    // and the root one an empty one -- the two shapes the picker asks for.
    yield* Effect.promise(() => $`git init -q`.cwd(root))

    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const send = Effect.fn(function* (input: { path: string; method?: string; body?: unknown }) {
      return yield* Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${input.path}`, {
            method: input.method ?? "GET",
            headers: { "content-type": "application/json" },
            body: input.body === undefined ? undefined : JSON.stringify(input.body),
          }),
        )
        expect(response.status).toBe(200)
        return response.text()
      })
    })

    yield* send({ path: "/api/session", method: "POST", body: { title: "root", location: { directory: root } } })
    yield* send({ path: "/api/session", method: "POST", body: { title: "nested", location: { directory: nested } } })

    const titlesAt = Effect.fn(function* (query: string) {
      const response = decodeList(yield* send({ path: `/api/session?${query}` }))
      return response.data.map((session) => session.title).sort()
    })

    // This is the query the picker sends from a project root. It has to arrive as an empty string
    // rather than being dropped, or the store cannot tell it from an absent filter.
    expect(yield* titlesAt("project=global&subpath=")).toEqual(["nested", "root"])
    expect(yield* titlesAt("project=global")).toEqual(["nested", "root"])
    // A real subpath must still narrow, and stay an exact match rather than a subtree match.
    expect(yield* titlesAt("project=global&subpath=packages%2Ftui")).toEqual(["nested"])
  }).pipe(Effect.scoped),
)
