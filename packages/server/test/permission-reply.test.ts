import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"
import { pluginsLoaded } from "./fixture/routes"

it.live("a tool.auto policy makes an allowed request ask and accepts only a confirmed approval", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-permission-reply-")
    const context = yield* Layer.build(
      createRoutes({
        password: "secret",
        database: { path: ":memory:" },
        models: { fetch: false },
        fs: { filewatcher: false },
        config: {
          directory: tmp.path,
          project: false,
          content: JSON.stringify({ policies: [{ action: "tool.auto", resource: "deploy:*", effect: "deny" }] }),
        },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (method: "GET" | "POST", route: string, body?: unknown) =>
      Effect.promise(async (signal) => {
        const url = new URL(route, "http://opencode.local")
        url.searchParams.set("location[directory]", tmp.path)
        const response = await handler(
          new Request(url, {
            method,
            headers: {
              authorization: `Basic ${btoa("opencode:secret")}`,
              ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
          }),
        )
        return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
      })

    yield* pluginsLoaded(context, tmp.path)
    const session = yield* request("POST", "/api/session", {
      location: { directory: tmp.path },
      permissions: [{ action: "deploy", resource: "*", effect: "allow" }],
    })
    const sessionID: string = session.body.data.id
    const asked = yield* request("POST", `/api/session/${sessionID}/permission`, {
      action: "deploy",
      resources: ["production"],
      save: ["*"],
    })
    expect(asked.body.data.effect).toBe("ask")
    const path = `/api/session/${sessionID}/permission/${asked.body.data.id}`
    const pending = yield* request("GET", path)
    expect(pending.body.data).toMatchObject({ required: true })
    expect(pending.body.data.save).toBeUndefined()

    const unconfirmed = yield* request("POST", `${path}/reply`, { decision: "once" })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body).toMatchObject({ _tag: "InvalidRequestError", kind: "permission_unconfirmed" })
    expect((yield* request("GET", path)).status).toBe(200)

    expect((yield* request("POST", `${path}/reply`, { decision: "once", confirmed: true })).status).toBe(204)
    expect((yield* request("GET", path)).status).toBe(404)
  }).pipe(Effect.scoped),
)
