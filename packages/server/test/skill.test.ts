import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live("skill.list includes native skills on the initial request", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-skill-endpoint-")
    const context = yield* Layer.build(
      createRoutes({
        password: "secret",
        database: { path: ":memory:" },
        models: { fetch: false },
        fs: { filewatcher: false },
        config: { directory: tmp.path },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const url = new URL("/api/skill", "http://opencode.local")
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise((signal) =>
      handler(
        new Request(url, {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
          signal,
        }),
      ),
    )
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ id: "opencode" }), expect.objectContaining({ id: "report" })]),
    })
  }),
  15_000,
)
