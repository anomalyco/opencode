import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMove } from "@opencode/core/session/move"
import { SessionProjector } from "@opencode/core/session/projector"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { initGit } from "./fixture/git"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      Session.node,
      SessionMove.node,
      LocationServiceMap.node,
    ]),
    [Global.node.replace(tempGlobalLayer), SessionExecution.node.replace(SessionExecution.noopLayer), offlineModels],
  ),
)

// A repository with a linked worktree, the way agents work in one and remove it after merging.
const repository = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  const main = AbsolutePath.make(path.join(tmp.path, "repo"))
  const linked = AbsolutePath.make(path.join(tmp.path, "linked"))
  yield* Effect.promise(async () => {
    await fs.mkdir(path.join(main, "app"), { recursive: true })
    await initGit(main)
    await Bun.write(path.join(main, "app", "README.md"), "app\n")
    await $`git add . && git commit -q -m root`.cwd(main).quiet()
    await $`git remote add origin git@github.com:owner/repo.git`.cwd(main).quiet()
    await $`git worktree add -q ${linked} -b linked`.cwd(main).quiet()
  })
  const remove = Effect.promise(() => $`git worktree remove --force ${linked}`.cwd(main).quiet())
  return { tmp, main, linked, remove }
})

describe("Session revive", () => {
  it.live(
    "moves a session whose worktree was removed to the main checkout when prompted",
    () =>
      Effect.gen(function* () {
        const repo = yield* repository
        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: repo.linked } })
        yield* repo.remove

        yield* sessions.prompt({ sessionID: created.id, text: "Still here?", resume: false })

        const session = yield* sessions.get(created.id)
        expect(session.location.directory).toBe(repo.main)
        expect(session.projectID).toBe(created.projectID)
        expect(yield* sessions.inbox(created.id)).toMatchObject([{ type: "user" }])
      }),
    { timeout: 20_000 },
  )

  it.live(
    "keeps the session's subdirectory when the main checkout has it",
    () =>
      Effect.gen(function* () {
        const repo = yield* repository
        const sessions = yield* Session.Service
        const moves = yield* SessionMove.Service
        const created = yield* sessions.create({
          location: { directory: AbsolutePath.make(path.join(repo.linked, "app")) },
        })
        yield* repo.remove

        yield* moves.revive(created.id)

        expect((yield* sessions.get(created.id)).location.directory).toBe(
          AbsolutePath.make(path.join(repo.main, "app")),
        )
      }),
    { timeout: 20_000 },
  )

  it.live(
    "leaves a session alone while its directory exists",
    () =>
      Effect.gen(function* () {
        const repo = yield* repository
        const sessions = yield* Session.Service
        const moves = yield* SessionMove.Service
        const created = yield* sessions.create({ location: { directory: repo.linked } })

        yield* moves.revive(created.id)

        expect((yield* sessions.get(created.id)).location.directory).toBe(repo.linked)
      }),
    { timeout: 20_000 },
  )

  it.live("leaves a session alone when it has no repository to return to", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const directory = AbsolutePath.make(path.join(tmp.path, "scratch"))
      yield* Effect.promise(() => fs.mkdir(directory))
      const sessions = yield* Session.Service
      const moves = yield* SessionMove.Service
      const created = yield* sessions.create({ location: { directory } })
      yield* Effect.promise(() => fs.rm(directory, { recursive: true }))

      yield* moves.revive(created.id)

      expect((yield* sessions.get(created.id)).location.directory).toBe(directory)
    }),
  )
})
