import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin as PluginSchema } from "@opencode/schema/plugin"
import { Plugin } from "@opencode/plugin/effect"
import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live(
  "plugin.list reports readiness without waiting and plugin.updated announces when it flips",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-plugin-ready-")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const context = yield* Layer.build(
        createRoutes({
          password: "secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false },
          config: { directory: tmp.path, project: false },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      )
      yield* Context.get(context, SdkPlugins.Service).register(
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
      const ready = Effect.promise(async () => {
        const url = new URL("/api/plugin", "http://opencode.local")
        url.searchParams.set("location[directory]", tmp.path)
        const response = await handler(
          new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
        )
        return ((await response.json()) as { ready: boolean }).ready
      })

      expect(yield* ready.pipe(Effect.timeout("2 seconds"))).toBe(false)
      yield* Deferred.await(started)
      expect(yield* ready.pipe(Effect.timeout("2 seconds"))).toBe(false)

      // A client re-reads plugin.list on each plugin.updated, so the last one must come after it turns true.
      const settled = yield* Context.get(context, Bus.Service)
        .subscribe([PluginSchema.Event.Updated])
        .pipe(
          Stream.mapEffect(() => ready),
          Stream.takeUntil((value) => value),
          Stream.runDrain,
          Effect.forkScoped({ startImmediately: true }),
        )
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(settled).pipe(Effect.timeout("5 seconds"))
      expect(yield* ready).toBe(true)
    }),
  15_000,
)
