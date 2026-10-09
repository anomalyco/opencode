import { expect } from "bun:test"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("loaded location inventory does not acquire the caller's location", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-loaded-")))
    const server = yield* startServer(tmp.path)
    const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
    yield* Effect.promise(async () => {
      expect(await api.location.list()).toEqual([])
      expect(await api.debug.location.list()).toEqual([])
      await api.location.get({ location: { directory: tmp.path } })
      expect(await api.location.list()).toEqual([{ directory: tmp.path }])
      expect(await api.debug.location.list()).toEqual([{ directory: tmp.path }])
    })
  }),
)
