import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { expect } from "bun:test"
import { Effect } from "effect"
import { OpenCode } from "@opencode-ai/client"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live(
  "keeps directory session discovery consistent when a cached location becomes a repository",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-location-identity-")))
      const directory = path.join(tmp.path, "project")
      const nested = path.join(directory, "app")
      yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))
      const server = yield* startServer(path.join(tmp.path, "config"))
      const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })

      yield* Effect.promise(async () => {
        const root = await api.session.create({ location: { directory }, title: "Before git" })
        const child = await api.session.create({ location: { directory: nested }, title: "Nested before git" })
        const before = await api.location.get({ location: { directory } })
        await api.location.get({ location: { directory: nested } })
        expect(before.project.id).toBe(root.projectID)

        await $`git init -q`.cwd(directory)
        // Session creation resolves the repository independently of the cached Location graph.
        const after = await api.session.create({ location: { directory }, title: "After git" })
        expect(after.projectID).toBe("global")

        for (const remote of [false, true]) {
          if (remote) await $`git remote add origin git@github.com:example/location-identity.git`.cwd(directory)
          for (const current of [directory, nested]) {
            const location = await api.location.get({ location: { directory: current } })
            expect(location.project.id === "global").toBe(!remote)
            expect(location.project.directory).toBe(directory)
            expect(await api.project.current({ location: { directory: current } })).toEqual(location.project)
            expect((await api.agent.list({ location: { directory: current } })).location).toEqual(location)
            const sessions = await api.session.list({
              ...(location.project.id === "global"
                ? { directory: current }
                : { project: location.project.id, subpath: path.relative(directory, current) }),
              parentID: null,
            })
            expect(sessions.data.map((session) => session.id).sort()).toEqual(
              (current === directory ? [root.id, after.id] : [child.id]).sort(),
            )
          }
        }
      })
    }),
  30_000,
)
