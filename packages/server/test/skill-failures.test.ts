import { expect } from "bun:test"
import path from "node:path"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { Skill } from "@opencode-ai/core/skill"
import { Plugin } from "@opencode-ai/plugin/effect"
import { Context, Effect, Layer, Logger } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live("skill.list reports the failing plugin without exposing its exception", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-skill-failures-")
    const messages: unknown[] = []
    const logger = Logger.make((options) => messages.push(options.message))
    const context = yield* Layer.build(
      createRoutes({
        password: "secret",
        database: { path: ":memory:" },
        models: { fetch: false },
        fs: { filewatcher: false },
        config: { directory: path.join(tmp.path, "config"), project: false },
      }).pipe(
        Layer.provide(HttpServer.layerServices),
        Layer.provideMerge(Logger.layer([logger], { mergeWithExisting: false })),
      ),
    )
    const sdk = Context.get(context, SdkPlugins.Service)
    const cause = new TypeError("synthetic-private-detail")
    yield* sdk.register(
      Plugin.define({
        id: "broken-skills",
        effect: (ctx) =>
          ctx.skill
            .transform(() => {
              throw cause
            })
            .pipe(Effect.asVoid),
      }),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (method: string, route: string) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${route}?location[directory]=${encodeURIComponent(tmp.path)}`, {
            method,
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
          }),
        ),
      )
    expect((yield* request("POST", "/api/plugin/await-activation")).status).toBe(204)
    // The directory is valid. A skill failure is not a location-not-found error.
    expect((yield* request("GET", "/api/location")).status).toBe(200)
    for (const attempt of [1, 2]) {
      const response = yield* request("GET", "/api/skill")
      expect(response.status).toBe(500)
      const body = yield* Effect.promise(() => response.text())
      expect(body).toContain('"PluginCallbackError"')
      expect(JSON.parse(body)).toEqual({
        _tag: "PluginCallbackError",
        pluginID: "broken-skills",
        operation: "skill.transform",
        message: 'Plugin "broken-skills" failed during skill.transform. Check server logs for details.',
      })
      expect(body).not.toContain("synthetic-private-detail")
      expect(body).not.toContain("TypeError")
      expect(body).not.toContain(tmp.path)
      expect(
        messages.filter((message) => Array.isArray(message) && message[0] === "Plugin callback failed"),
      ).toHaveLength(attempt)
    }
    expect(messages).toContainEqual([
      "Plugin callback failed",
      expect.objectContaining({ pluginID: "broken-skills", operation: "skill.transform", cause }),
    ])
  }).pipe(Effect.timeout("10 seconds")),
)

for (const scenario of [
  { name: "unrelated defects", effect: Effect.die(new Error("unrelated-private-detail")), status: 500 },
  // Effect's HTTP boundary maps server interruption to 503 (a client abort is 499).
  { name: "interruption", effect: Effect.interrupt, status: 503 },
]) {
  it.live(`skill.list does not label ${scenario.name} as plugin callback failures`, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-skill-control-")
      const context = yield* Layer.build(
        createRoutes(
          {
            password: "secret",
            database: { path: ":memory:" },
            models: { fetch: false },
            fs: { filewatcher: false },
            config: { directory: tmp.path, project: false },
          },
          () => [],
          [
            Skill.node.replace(
              Layer.succeed(
                Skill.Service,
                Skill.Service.of({
                  list: () => scenario.effect,
                  get: () => Effect.undefined,
                  reload: () => Effect.void,
                  transform: () => Effect.succeed({ dispose: Effect.void }),
                }),
              ),
            ),
          ],
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const response = yield* Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api/skill?location[directory]=${encodeURIComponent(tmp.path)}`, {
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
          }),
        ),
      )
      expect(response.status).toBe(scenario.status)
      expect(yield* Effect.promise(() => response.text())).toBe("")
    }).pipe(Effect.timeout("10 seconds")),
  )
}
