import { expect } from "bun:test"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin } from "@opencode/plugin/effect"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live(
  "agent and provider lists wait for plugins while single provider reads stay nonblocking",
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
      const request = (method: "GET" | "POST", route: string) =>
        Effect.promise((signal) => {
          const url = new URL(route, "http://opencode.local")
          url.searchParams.set("location[directory]", tmp.path)
          return handler(
            new Request(url, {
              method,
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              signal,
            }),
          )
        })
      // Config providers and agents activate after SDK plugins, so the lists wait rather than answer with a partial
      // catalog that a client would cache as loaded.
      const providers = yield* request("GET", "/api/provider").pipe(Effect.forkScoped)
      const agents = yield* request("GET", "/api/agent").pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      const integrations = yield* request("GET", "/api/integration").pipe(Effect.forkScoped)
      const get = yield* request("GET", "/api/provider/custom").pipe(Effect.timeout("2 seconds"))
      expect(get.status).toBe(404)
      expect(yield* Effect.promise(() => get.json())).toMatchObject({
        _tag: "ProviderNotFoundError",
        providerID: "custom",
      })
      expect(providers.pollUnsafe()).toBeUndefined()
      expect(agents.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(release, undefined)
      const list = yield* Fiber.join(providers)
      expect(list.status).toBe(200)
      expect(yield* Effect.promise(() => list.json())).toMatchObject({
        location: { directory: tmp.path },
        data: expect.arrayContaining([expect.objectContaining({ id: "custom" })]),
      })
      const agentList = yield* Fiber.join(agents)
      expect(agentList.status).toBe(200)
      expect(yield* Effect.promise(() => agentList.json())).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({ id: "build" }),
          expect.objectContaining({ id: "reviewer" }),
        ]),
      })
      const discovered = yield* Fiber.join(integrations)
      expect(discovered.status).toBe(200)
      expect(yield* Effect.promise(() => discovered.json())).toMatchObject({
        data: expect.arrayContaining([expect.objectContaining({ id: "opencode" })]),
      })
    }),
  15_000,
)
