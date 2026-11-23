import { expect } from "bun:test"
import { Context, Effect, Fiber, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { Instance } from "@opencode/core/instance/service"
import { Plugin } from "@opencode/core/plugin"
import { Session } from "@opencode/schema/session"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { createEmbeddedRoutes } from "../src/routes"

it.live("the first permission API call waits for configured rules to activate", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: {
        directory: directory.path,
        project: false,
        content: JSON.stringify({ permissions: [{ action: "read", resource: "*", effect: "deny" }] }),
      },
    })
    const post = (path: string, body: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )
    const created = yield* post("/api/session", { location: { directory: directory.path } })
    const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
      yield* Effect.promise(() => created.json()),
    ).data
    // No model call, plugin inventory request, or other warm-up precedes this request.
    const asked = yield* post(`/api/session/${session.id}/permission`, { action: "read", resources: ["README.md"] })
    expect(asked.status).toBe(200)
    expect(yield* Effect.promise(() => asked.json())).toMatchObject({ data: { effect: "deny" } })
  }).pipe(Effect.scoped),
)

it.live("permission evaluation waits while a plugin update is announced", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const context = yield* Layer.build(
      createEmbeddedRoutes({
        database: { path: ":memory:" },
        models: { fetch: false },
        fs: { filewatcher: false },
        config: { directory: directory.path, project: false, content: "{}" },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const post = (path: string, body: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )
    const created = yield* post("/api/session", { location: { directory: directory.path } })
    const session = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
      yield* Effect.promise(() => created.json()),
    ).data
    const instances = Context.get(context, Instance.Service)
    const release = yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      return yield* plugins.hold()
    }).pipe(instances.provide(session))
    const request = yield* post(`/api/session/${session.id}/permission`, {
      action: "read",
      resources: ["README.md"],
    }).pipe(Effect.forkChild({ startImmediately: true }))
    // Let the HTTP request drain its microtasks while readiness is held; no timer or elapsed-time assertion.
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)))
    yield* Effect.sync(() => expect(request.pollUnsafe()).toBeUndefined()).pipe(Effect.ensuring(release))
    expect((yield* Fiber.join(request)).status).toBe(200)
  }).pipe(Effect.scoped),
)
