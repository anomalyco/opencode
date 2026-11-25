import { expect } from "bun:test"
import { isForbiddenError, isInvalidRequestError, OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const start = Effect.fnUntraced(function* (enabled: boolean) {
  const directory = (yield* tmpdirScoped("opencode-preference-")).path
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    config: { directory, project: false, content: JSON.stringify({ experimental: { web_preferences: enabled } }) },
    models: { fetch: false },
    fs: { filewatcher: false },
  })
  return OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  }).experimental.preference
})

const failure = (call: Promise<unknown>) =>
  call.then(
    () => undefined,
    (error: unknown) => error,
  )

it.live("sets, overwrites and removes the keys of a namespace", () =>
  Effect.gen(function* () {
    const preference = yield* start(true)
    const name = "opencode.global.dat"
    yield* Effect.promise(async () => {
      expect(await preference.items({ name })).toEqual({})
      await preference.update({ name, insert: { language: '"en"', "server:recent": "[]" }, remove: [] })
      expect(await preference.items({ name })).toEqual({ language: '"en"', "server:recent": "[]" })
      await preference.update({ name, insert: { language: '"de"' }, remove: ["server:recent"] })
      expect(await preference.items({ name })).toEqual({ language: '"de"' })
      // A key both set and removed in one request ends up removed.
      await preference.update({ name, insert: { theme: "dark" }, remove: ["theme"] })
      expect(await preference.items({ name })).toEqual({ language: '"de"' })
    })
  }),
)

it.live("keeps namespaces apart, also one whose name begins another's, and clears only the one named", () =>
  Effect.gen(function* () {
    const preference = yield* start(true)
    const names = ["default.dat", "opencode.global", "opencode.global.dat"]
    yield* Effect.promise(async () => {
      await Promise.all(names.map((name) => preference.update({ name, insert: { owner: name }, remove: [] })))
      expect(await Promise.all(names.map((name) => preference.items({ name })))).toEqual(
        names.map((name) => ({ owner: name })),
      )
      await preference.clear({ name: "opencode.global" })
      expect(await Promise.all(names.map((name) => preference.items({ name })))).toEqual([
        { owner: "default.dat" },
        {},
        { owner: "opencode.global.dat" },
      ])
    })
  }),
)

it.live("rejects a namespace name holding : or / with 400 InvalidRequestError", () =>
  Effect.gen(function* () {
    const preference = yield* start(true)
    const results = yield* Effect.promise(() =>
      Promise.all(
        ["a:b", "a/b"].flatMap((name) =>
          [
            preference.items({ name }),
            preference.update({ name, insert: { key: "value" }, remove: [] }),
            preference.clear({ name }),
          ].map(failure),
        ),
      ),
    )
    expect(results.map(isInvalidRequestError)).toEqual([true, true, true, true, true, true])
  }),
)

it.live("rejects every preference route with 403 ForbiddenError while web_preferences is off", () =>
  Effect.gen(function* () {
    const preference = yield* start(false)
    const name = "opencode.global.dat"
    const results = yield* Effect.promise(() =>
      Promise.all(
        [
          preference.items({ name }),
          preference.update({ name, insert: { key: "value" }, remove: [] }),
          preference.clear({ name }),
        ].map(failure),
      ),
    )
    expect(results.map(isForbiddenError)).toEqual([true, true, true])
  }),
)
