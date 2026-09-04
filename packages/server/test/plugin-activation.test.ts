import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { Plugin } from "@opencode-ai/plugin/effect"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const fixture = Effect.fn(function* (plugin: Plugin.Plugin) {
  const tmp = yield* tmpdirScoped("opencode-plugin-activation-")
  const first = path.join(tmp.path, "first")
  const second = path.join(tmp.path, "second")
  const config = path.join(tmp.path, "config")
  yield* Effect.promise(() => Promise.all([first, second, config].map((directory) => mkdir(directory))))
  const context = yield* Layer.build(
    createRoutes({
      password: "secret",
      database: { path: ":memory:" },
      models: { fetch: false },
      fs: { filewatcher: false },
      config: {
        directory: config,
        project: false,
        content: JSON.stringify({
          providers: {
            acme: {
              models: {
                reasoner: { name: "Configured Reasoner", limit: { context: 96_000, output: 8_000 } },
              },
            },
          },
        }),
      },
    }).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const sdk = Context.get(context, SdkPlugins.Service)
  yield* sdk.register(plugin)
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  return {
    first,
    second,
    request: (method: "GET" | "POST", route: string, directory = first, signal?: AbortSignal) =>
      Effect.promise((interruption) => {
        const url = new URL(route, "http://opencode.local")
        url.searchParams.set("location[directory]", directory)
        return handler(
          new Request(url, {
            method,
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
            signal: signal ?? interruption,
          }),
        )
      }),
  }
})

it.live(
  "awaits activation only for the requested location without blocking model or plugin snapshots",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const server = yield* fixture(
        Plugin.define({
          id: "slow-plugin",
          effect: (ctx) =>
            Effect.gen(function* () {
              if (path.basename(ctx.location.directory) !== "first") return
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
            }),
        }),
      )
      const pending = yield* server.request("POST", "/api/plugin/await-activation").pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      expect(pending.pollUnsafe()).toBeUndefined()

      const models = yield* server.request("GET", "/api/model")
      expect(models.status).toBe(200)
      expect(yield* Effect.promise(() => models.json())).toMatchObject({
        location: { directory: server.first },
        data: expect.not.arrayContaining([expect.objectContaining({ providerID: "acme", id: "reasoner" })]),
      })
      const plugins = yield* server.request("GET", "/api/plugin")
      expect(plugins.status).toBe(200)
      expect(yield* Effect.promise(() => plugins.json())).toMatchObject({ location: { directory: server.first } })

      const second = yield* server.request("POST", "/api/plugin/await-activation", server.second)
      expect(second.status).toBe(204)
      expect(pending.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(release, undefined)
      const response = yield* Fiber.join(pending)
      expect(response.status).toBe(204)
      expect(yield* Effect.promise(() => response.text())).toBe("")
      const configured = yield* server.request("GET", "/api/model")
      expect(configured.status).toBe(200)
      expect(yield* Effect.promise(() => configured.json())).toMatchObject({
        location: { directory: server.first },
        data: expect.arrayContaining([
          expect.objectContaining({
            providerID: "acme",
            id: "reasoner",
            name: "Configured Reasoner",
            limit: { context: 96_000, output: 8_000 },
          }),
        ]),
      })
      const active = yield* server.request("GET", "/api/plugin")
      expect(active.status).toBe(200)
      expect(yield* Effect.promise(() => active.json())).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({ id: "slow-plugin", source: { type: "sdk" }, state: { status: "active" } }),
        ]),
      })
    }).pipe(Effect.timeout("10 seconds")),
  15_000,
)

it.live(
  "aborting an activation wait does not cancel plugin setup",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const server = yield* fixture(
        Plugin.define({
          id: "slow-plugin",
          effect: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              yield* Deferred.succeed(completed, undefined)
            }).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
        }),
      )
      const controller = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()))
      const pending = yield* server
        .request("POST", "/api/plugin/await-activation", server.first, controller.signal)
        .pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      controller.abort()
      // HttpEffect resolves a cancelled Web request with 499 rather than rejecting its Promise.
      expect((yield* Fiber.join(pending)).status).toBe(499)
      expect(yield* Deferred.isDone(interrupted)).toBe(false)
      expect(yield* Deferred.isDone(completed)).toBe(false)

      yield* Deferred.succeed(release, undefined)
      expect((yield* server.request("POST", "/api/plugin/await-activation")).status).toBe(204)
      expect(yield* Deferred.isDone(completed)).toBe(true)
      expect(yield* Deferred.isDone(interrupted)).toBe(false)
      const plugins = yield* server.request("GET", "/api/plugin")
      expect(plugins.status).toBe(200)
      expect(yield* Effect.promise(() => plugins.json())).toMatchObject({
        data: expect.arrayContaining([expect.objectContaining({ id: "slow-plugin", state: { status: "active" } })]),
      })
    }).pipe(Effect.timeout("10 seconds")),
  15_000,
)

it.live(
  "settles activation when plugin setup fails and exposes the failure in the inventory",
  () =>
    Effect.gen(function* () {
      const server = yield* fixture(
        Plugin.define({
          id: "failing-plugin",
          effect: () => Effect.die(new Error("fixture setup failed")),
        }),
      )
      expect((yield* server.request("POST", "/api/plugin/await-activation")).status).toBe(204)
      const plugins = yield* server.request("GET", "/api/plugin")
      expect(plugins.status).toBe(200)
      expect(yield* Effect.promise(() => plugins.json())).toMatchObject({
        location: { directory: server.first },
        data: expect.arrayContaining([
          expect.objectContaining({
            id: "failing-plugin",
            source: { type: "sdk" },
            state: { status: "failed", error: expect.stringContaining("fixture setup failed") },
          }),
        ]),
      })
    }).pipe(Effect.timeout("10 seconds")),
  15_000,
)
