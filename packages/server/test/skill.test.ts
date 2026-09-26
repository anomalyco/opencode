import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("waits for skill discovery on the first catalog request", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-skill-catalog-")))
    const directory = path.join(tmp.path, "skills")
    yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
    yield* Effect.promise(() =>
      fs.writeFile(path.join(directory, "smoke.md"), "---\ndescription: Smoke test\n---\nReply OK."),
    )
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/skill", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    expect(response.status).toBe(200)
    const body: unknown = yield* Effect.promise(() => response.json())
    expect(body).toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ id: "smoke" })]) })
  }),
)
