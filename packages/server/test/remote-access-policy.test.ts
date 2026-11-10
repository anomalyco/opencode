import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const tunnel = "https://r4nd0m.tunnel.example"

const routes = (policies: unknown[]) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-remote-access-")
    const context = yield* Layer.build(
      createRoutes(
        {
          password: "secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false },
          config: { directory: tmp.path, project: false, content: JSON.stringify({ policies }) },
        },
        () => [],
        [],
        () => [tunnel],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    return (origin: string) =>
      Effect.promise(async (signal) => {
        const url = new URL("/api/config", origin)
        url.searchParams.set("location[directory]", tmp.path)
        const response = await handler(
          new Request(url, {
            headers: { host: url.host, authorization: `Basic ${btoa("opencode:secret")}` },
            signal,
          }),
        )
        return { status: response.status, body: await response.json() }
      })
  })

it.live("refuses requests through the remote access tunnel while a remote.use policy denies it", () =>
  Effect.gen(function* () {
    const request = yield* routes([{ action: "remote.use", resource: "*", effect: "deny" }])

    const remote = yield* request(tunnel)
    expect(remote.status).toBe(403)
    expect(remote.body).toEqual({
      _tag: "ForbiddenError",
      message: "Blocked by configuration policy: remote access is not allowed",
    })
    // The same server still answers on its own address.
    expect((yield* request("http://127.0.0.1:4096")).status).toBe(200)
  }),
)

it.live("serves requests through the remote access tunnel without a remote.use deny", () =>
  Effect.gen(function* () {
    const request = yield* routes([{ action: "websearch.use", resource: "*", effect: "deny" }])
    expect((yield* request(tunnel)).status).toBe(200)
  }),
)
