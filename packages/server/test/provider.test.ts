import { expect } from "bun:test"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin } from "@opencode/plugin/effect"
import { Context, Deferred, Effect, Fiber, Layer, Option } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live(
  "policy-controlled endpoints wait for plugins while other catalog reads answer",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-provider-endpoints-")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
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
              providers: {
                custom: {
                  name: "Configured Custom Provider",
                  package: "@opencode/ai/providers/openai-compatible",
                  settings: { apiKey: "secret" },
                  models: { chat: {} },
                },
              },
              agents: { reviewer: { description: "Reviews changes" } },
            }),
          },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const sdk = Context.get(context, SdkPlugins.Service)
      yield* sdk.register(
        Plugin.define({
          id: "slow-plugin",
          effect: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
            }),
        }),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const request = (method: "GET" | "POST", route: string, body?: unknown) =>
        Effect.promise((signal) => {
          const url = new URL(route, "http://opencode.local")
          url.searchParams.set("location[directory]", tmp.path)
          return handler(
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
        })
      yield* request("GET", "/api/agent").pipe(Effect.timeout("2 seconds"))
      yield* Deferred.await(started)
      // Managed policy is applied by the last internal plugin, so endpoints whose entries it can deny wait until
      // activation finishes rather than serve a provider it would remove.
      const providers = yield* request("GET", "/api/provider").pipe(Effect.forkScoped)
      const models = yield* request("GET", "/api/model").pipe(Effect.forkScoped)
      const search = yield* request("POST", "/api/websearch", { query: "opencode" }).pipe(
        Effect.forkScoped,
      )
      // Everything else answers with the current snapshot, and clients refresh on the matching *.updated events.
      for (const route of ["/api/agent", "/api/skill", "/api/integration"]) {
        const response = yield* request("GET", route).pipe(Effect.timeout("2 seconds"))
        expect(response.status).toBe(200)
      }
      const get = yield* request("GET", "/api/provider/custom").pipe(Effect.timeout("2 seconds"))
      expect(get.status).toBe(404)
      expect(yield* Effect.promise(() => get.json())).toMatchObject({
        _tag: "ProviderNotFoundError",
        providerID: "custom",
      })
      const pending = yield* Effect.all(
        [providers, models, search].map((fiber) => Fiber.await(fiber).pipe(Effect.timeoutOption("500 millis"))),
        { concurrency: "unbounded" },
      )
      expect(pending.every(Option.isNone)).toBeTrue()

      yield* Deferred.succeed(release, undefined)
      const list = yield* Fiber.join(providers)
      expect(list.status).toBe(200)
      expect(yield* Effect.promise(() => list.json())).toMatchObject({
        location: { directory: tmp.path },
        data: expect.arrayContaining([expect.objectContaining({ id: "custom" })]),
      })
      expect((yield* Fiber.join(models)).status).toBe(200)
      expect((yield* Fiber.join(search)).status).toBe(400)
    }),
  15_000,
)
