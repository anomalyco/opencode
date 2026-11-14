import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { expect } from "bun:test"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { ModelsDev } from "@opencode/core/models-dev"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, RcMap, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { initGit } from "../../core/test/fixture/git"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes } from "../src/routes"

const requests = [
  ["/api/session/:id/prompt", { text: "Still here?", resume: false }],
  ["/api/session/:id/command", { name: "hello", text: "" }],
  ["/api/session/:id/shell", { command: "true" }],
  ["/api/experimental/session/:id/skill", { id: "greet", resume: false }],
] as const

const server = Effect.gen(function* () {
  const context = yield* Layer.build(
    createEmbeddedRoutes({}, [
      Global.node.replace(tempGlobalLayer),
      Database.node.replace(Database.node),
      Bus.node.replace(Bus.node),
      App.node.replace(App.node),
      ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ]).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const sessions = Context.get(context, Session.Service)
  const locations = Context.get(context, LocationServiceMap.Service)
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  return {
    sessions,
    bus: Context.get(context, Bus.Service),
    // A removed folder's services aren't cached, so a request has to boot them from scratch.
    forget: (session: Session.Info) =>
      RcMap.invalidate(locations.rcMap, LocationServiceMap.canonical(session.location)),
    post: (route: string, sessionID: string, body: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${route.replace(":id", sessionID)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        )
        const text = await response.text()
        return { route, status: response.status, tag: text ? (JSON.parse(text) as { _tag?: string })._tag : undefined }
      }),
  }
})

it.live(
  "revives sessions whose worktree was removed when they are prompted, commanded, shelled or given a skill",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const main = path.join(tmp.path, "repo")
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(main, ".opencode", "commands"), { recursive: true })
        await fs.mkdir(path.join(main, ".opencode", "skills", "greet"), { recursive: true })
        await initGit(main)
        await Bun.write(path.join(main, ".opencode", "commands", "hello.md"), "Say hello\n")
        await Bun.write(
          path.join(main, ".opencode", "skills", "greet", "SKILL.md"),
          "---\nname: greet\ndescription: Greets people\n---\nSay hi.\n",
        )
        await $`git add . && git commit -q -m root`.cwd(main).quiet()
      })
      const app = yield* server
      const moved: string[] = []
      yield* app.bus.subscribe(SessionEvent.Moved).pipe(
        Stream.runForEach((event) => Effect.sync(() => moved.push(event.data.sessionID))),
        Effect.forkScoped,
      )
      yield* Effect.yieldNow

      for (const [route, body] of requests) {
        const linked = path.join(tmp.path, `linked-${path.basename(route)}`)
        yield* Effect.promise(() => $`git worktree add -q ${linked} -b ${path.basename(route)}`.cwd(main).quiet())
        const session = yield* app.sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(linked) }),
        })
        yield* Effect.promise(() => $`git worktree remove --force ${linked}`.cwd(main).quiet())
        yield* app.forget(session)

        const result = yield* app.post(route, session.id, body)

        expect({ ...result, ok: result.status < 300 }).toMatchObject({ route, ok: true })
        expect((yield* app.sessions.get(session.id)).location.directory).toBe(AbsolutePath.make(main))
        expect(moved).toContain(session.id)
      }
    }),
  { timeout: 60_000 },
)

it.live("still reports a missing folder outside any repository as not found", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const directory = path.join(tmp.path, "scratch")
    yield* Effect.promise(() => fs.mkdir(directory))
    const app = yield* server
    const session = yield* app.sessions.create({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
    })
    yield* Effect.promise(() => fs.rm(directory, { recursive: true }))
    yield* app.forget(session)

    const results = yield* Effect.forEach(requests, ([route, body]) => app.post(route, session.id, body))

    expect(results.map(({ status, tag }) => ({ status, tag }))).toEqual(
      Array(requests.length).fill({ status: 404, tag: "LocationNotFoundError" }),
    )
    expect(yield* app.sessions.inbox(session.id)).toEqual([])
  }),
)
