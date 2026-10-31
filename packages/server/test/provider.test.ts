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
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              yield* ctx.integration.transform((editor) =>
                editor.update("late-integration", (integration) => {
                  integration.name = "Late integration"
                }),
              )
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
              headers: {
                authorization: `Basic ${btoa("opencode:secret")}`,
                ...(method === "POST" ? { "content-type": "application/json" } : {}),
              },
              ...(method === "POST" ? { body: JSON.stringify({ methodID: "missing" }) } : {}),
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
      const integration = yield* request("GET", "/api/integration/late-integration").pipe(
        Effect.forkScoped({ startImmediately: true }),
      )
      const oauth = yield* request("GET", "/api/integration/late-integration/connect/oauth/missing").pipe(
        Effect.forkScoped({ startImmediately: true }),
      )
      const command = yield* request("POST", "/api/integration/late-integration/connect/command").pipe(
        Effect.forkScoped({ startImmediately: true }),
      )
      const get = yield* request("GET", "/api/provider/custom").pipe(Effect.timeout("2 seconds"))
      expect(get.status).toBe(404)
      expect(yield* Effect.promise(() => get.json())).toMatchObject({
        _tag: "ProviderNotFoundError",
        providerID: "custom",
      })
      expect(providers.pollUnsafe()).toBeUndefined()
      expect(agents.pollUnsafe()).toBeUndefined()
      expect(integration.pollUnsafe()).toBeUndefined()
      expect(oauth.pollUnsafe()).toBeUndefined()
      expect(command.pollUnsafe()).toBeUndefined()
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
      const item = yield* Fiber.join(integration)
      expect(item.status).toBe(200)
      expect(yield* Effect.promise(() => item.json())).toMatchObject({ data: { id: "late-integration" } })
      const attempt = yield* Fiber.join(oauth)
      expect(attempt.status).toBe(404)
      expect(yield* Effect.promise(() => attempt.json())).toMatchObject({ _tag: "IntegrationAttemptNotFoundError" })
      const commandResult = yield* Fiber.join(command)
      expect(commandResult.status).toBe(404)
      expect(yield* Effect.promise(() => commandResult.json())).toMatchObject({ _tag: "IntegrationMethodNotFoundError" })
    }),
  15_000,
)
