import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Flag } from "@opencode/core/flag"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

/** Requests the flags of a fresh location, written with `project` as its opencode.json, on a server of `channel`. */
const request = (input: { channel: "dev" | "latest"; overrides?: string; project?: object }) =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-flag-endpoint-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    yield* Effect.promise(() => fs.mkdir(global))
    yield* Effect.promise(() => fs.mkdir(project))
    if (input.project)
      yield* Effect.promise(() => Bun.write(path.join(project, "opencode.json"), JSON.stringify(input.project)))
    const handler = yield* ServerFetch.make({
      app: { channel: input.channel, version: "test" },
      database: { path: ":memory:" },
      config: { directory: global, claude: false },
      fs: { filewatcher: false },
      models: { fetch: false },
    }).pipe(Effect.provideService(Flag.Overrides, input.overrides))
    const url = new URL("/api/experimental/flag", "http://opencode.local")
    url.searchParams.set("location[directory]", project)
    const response = yield* Effect.promise(() => handler(new Request(url)))
    return { status: response.status, body: yield* Effect.promise(() => response.json()), project }
  })

it.live("reports full_codemode on by default in dev builds", () =>
  Effect.gen(function* () {
    const result = yield* request({ channel: "dev" })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      location: expect.objectContaining({ directory: result.project }),
      data: { full_codemode: true, go_settings: true },
    })
  }),
)

it.live("reports full_codemode off by default in releases", () =>
  Effect.gen(function* () {
    const result = yield* request({ channel: "latest" })
    expect(result.body.data).toEqual({ full_codemode: false, go_settings: false })
  }),
)

it.live("follows the project's opencode.json", () =>
  Effect.gen(function* () {
    const on = yield* request({ channel: "latest", project: { experimental: { full_codemode: true } } })
    const off = yield* request({ channel: "dev", project: { experimental: { full_codemode: false } } })
    expect(on.body.data.full_codemode).toBe(true)
    expect(off.body.data.full_codemode).toBe(false)
  }),
)

it.live("lets OPENCODE_FLAGS override config", () =>
  Effect.gen(function* () {
    const on = yield* request({
      channel: "latest",
      overrides: "full_codemode",
      project: { experimental: { full_codemode: false } },
    })
    const off = yield* request({ channel: "dev", overrides: "-full_codemode" })
    expect(on.body.data.full_codemode).toBe(true)
    expect(off.body.data.full_codemode).toBe(false)
  }),
)

it.live("only reports allowlisted flags", () =>
  Effect.gen(function* () {
    const result = yield* request({ channel: "dev", overrides: "all" })
    expect(Object.keys(result.body.data)).toEqual(["full_codemode", "go_settings"])
  }),
)
