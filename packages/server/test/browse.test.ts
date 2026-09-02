import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

const setup = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-browse-endpoint-")))
  const root = path.join(tmp.path, "root")
  yield* Effect.promise(() => fs.mkdir(path.join(root, "child"), { recursive: true }))
  yield* Effect.promise(() => fs.writeFile(path.join(root, "file.txt"), "content"))
  const server = yield* startServer(path.join(tmp.path, "config"))
  return { root, server }
})

it.live("browse lists direct children of a host directory", () =>
  Effect.gen(function* () {
    const { root, server } = yield* setup
    const url = new URL("/api/browse/list", server.base)
    url.searchParams.set("directory", root)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    const listed = yield* Effect.promise(() => response.json())
    expect(response.status).toBe(200)
    expect(listed.directory).toBe(root)
    expect(listed.entries).toEqual([
      { path: `child${path.sep}`, type: "directory" },
      { path: "file.txt", type: "file" },
    ])
  }),
)

it.live("browse rejects missing directories", () =>
  Effect.gen(function* () {
    const { root, server } = yield* setup
    const url = new URL("/api/browse/list", server.base)
    url.searchParams.set("directory", path.join(root, "missing"))
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    expect(response.status).toBe(400)
  }),
)

it.live("browse rejects paths that are not directories", () =>
  Effect.gen(function* () {
    const { root, server } = yield* setup
    const url = new URL("/api/browse/list", server.base)
    url.searchParams.set("directory", path.join(root, "file.txt"))
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    expect(response.status).toBe(400)
  }),
)
