import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live("lists configured MCP servers on the first request to a cold location", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-mcp-list-")
    const context = yield* Layer.build(
      createRoutes({
        password: "secret",
        database: { path: ":memory:" },
        models: { fetch: false },
        fs: { filewatcher: false },
        config: {
          directory: tmp.path,
          project: false,
          content: JSON.stringify({
            mcp: { servers: { docs: { type: "local", command: ["unused"], disabled: true } } },
          }),
        },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const url = new URL("/api/mcp", "http://opencode.local")
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise((signal) =>
      handler(new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` }, signal })),
    )

    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      location: { directory: tmp.path },
      data: [{ name: "docs", status: { status: "disabled" } }],
    })
    expect(response.status).toBe(200)
  }),
)
