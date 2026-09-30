import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("reads an existing directory through the existing location endpoint", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const existing = path.join(tmp.path, "existing")
    yield* Effect.promise(() => fs.mkdir(existing))
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/location", server.base)
    url.searchParams.set("location[directory]", existing)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    expect(response.status).toBe(200)
    expect((yield* Effect.promise(() => response.json())).directory).toBe(existing)

    const header = yield* Effect.promise(() =>
      fetch(new URL("/api/location", server.base), {
        headers: { ...server.headers, "x-opencode-directory": encodeURIComponent(existing) },
      }),
    )
    expect((yield* Effect.promise(() => header.json())).directory).toBe(existing)

    const precedence = yield* Effect.promise(() =>
      fetch(url, {
        headers: { ...server.headers, "x-opencode-directory": encodeURIComponent(path.join(tmp.path, "removed")) },
      }),
    )
    expect((yield* Effect.promise(() => precedence.json())).directory).toBe(existing)

    const defaultLocation = yield* Effect.promise(() =>
      fetch(new URL("/api/location", server.base), { headers: server.headers }),
    )
    expect(defaultLocation.status).toBe(200)
    expect((yield* Effect.promise(() => defaultLocation.json())).directory).toBe(process.cwd())

    yield* Effect.promise(() => fs.rmdir(existing))
    const removed = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    expect(removed.status).toBe(404)
    expect(yield* Effect.promise(() => removed.json())).toMatchObject({
      _tag: "LocationNotFoundError",
      directory: existing,
    })
  }),
)

it.live("reports only a missing or non-directory location as a typed 404 before booting", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const missing = path.join(tmp.path, "removed")
    const file = path.join(tmp.path, "file")
    const loop = path.join(tmp.path, "loop")
    yield* Effect.promise(async () => {
      await fs.writeFile(file, "content")
      await fs.symlink(loop, loop)
    })
    const server = yield* startServer(tmp.path)
    const get = (directory: string) =>
      Effect.promise(async () => {
        const url = new URL("/api/location", server.base)
        url.searchParams.set("location[directory]", directory)
        const response = await fetch(url, { headers: server.headers })
        return { status: response.status, body: await response.json() }
      })

    for (const directory of [missing, file, path.join(file, "child")]) {
      expect(yield* get(directory)).toMatchObject({
        status: 404,
        body: { _tag: "LocationNotFoundError", directory },
      })
    }
    expect((yield* get(loop)).status).toBe(500)
    const probe = yield* Effect.promise(() =>
      fetch(new URL("/api/location/probe", server.base), { headers: server.headers }),
    )
    expect(probe.status).toBe(404)
    const loaded = yield* Effect.promise(async () =>
      (await fetch(new URL("/api/debug/location", server.base), { headers: server.headers })).json(),
    )
    expect(loaded).toEqual([])
  }),
)
