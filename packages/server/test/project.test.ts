import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("listing projects does not reload an evicted location", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const server = yield* startServer(path.join(tmp.path, "config"))
    const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
    yield* Effect.promise(async () => {
      const location = await api.location.get({ location: { directory: tmp.path } })
      expect(await api.debug.location.list()).toEqual([{ directory: tmp.path }])

      await api.debug.location.evict({ location: { directory: tmp.path } })
      expect(await api.debug.location.list()).toEqual([])

      expect(await api.project.list()).toContainEqual(expect.objectContaining({ id: location.project.id }))
      expect(await api.debug.location.list()).toEqual([])
    })
  }),
)
