import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import type { PluginRoute } from "@opencode-ai/plugin"
import { pathToFileURL } from "url"
import path from "path"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { PluginRoutesDispatcher } from "@/server/plugin-routes"
import { Plugin } from "@/plugin/index"
import { InstanceStore } from "@/project/instance-store"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

// CrossSpawnSpawner is required by tmpdirScoped (git operations) and the
// plugin loader. Group it with FSUtil so both are available in the test layer.
const spawnerLayer = LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node]))

const it = testEffect(Layer.mergeAll(spawnerLayer, testInstanceStoreLayer))

function mockPlugin(table: { id: string; routes: PluginRoute[] }[]) {
  return Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      trigger: ((_name: string, _input: unknown, output: unknown) => Effect.succeed(output)) as Plugin.Interface["trigger"],
      routes: () => Effect.succeed(table),
      list: () => Effect.succeed([]),
    }),
  )
}

function app(directory: string, pluginLayer: Layer.Layer<never>) {
  const handler = HttpRouter.toWebHandler(
    PluginRoutesDispatcher.layer.pipe(
      Layer.provide(pluginLayer),
      Layer.provide(testInstanceStoreLayer),
      Layer.provide(spawnerLayer),
      Layer.provide(HttpServer.layerServices),
    ) as unknown as Layer.Layer<never>,
    { disableLogger: true },
  ).handler
  return (input: string, init?: RequestInit) =>
    Effect.promise(() =>
      handler(
        new Request(`http://localhost${input}`, {
          headers: { "x-opencode-directory": directory, ...(init?.headers as Record<string, string> | undefined) },
          ...init,
        }),
        Context.makeUnsafe(new Map()),
      ),
    )
}

function json(response: Response) {
  return Effect.promise(() => response.json() as Promise<unknown>)
}

function text(response: Response) {
  return Effect.promise(() => response.text())
}

describe("plugin http routes", () => {
  it.live("dispatches to a plugin route with params, query and json body", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const call = app(
        directory,
        mockPlugin([
          {
            id: "demo",
            routes: [
              {
                method: "GET",
                path: "/issue/:id",
                handler: async (request) => ({
                  body: { id: request.params.id, path: request.path, query: request.query, method: request.method },
                }),
              },
              {
                method: "POST",
                path: "/webhook",
                handler: async (request) => {
                  if (request.headers["x-webhook-secret"] !== "s3cret")
                    return { status: 401, body: { error: "invalid secret" } }
                  const body = request.body as { text?: string; sessionID?: string }
                  if (!body?.text) return { status: 400, body: { error: "text is required" } }
                  const sessionID = body.sessionID ?? "created"
                  return { status: 202, body: { sessionID } }
                },
              },
            ],
          },
        ]),
      )
      return yield* provideInstance(directory)(
        Effect.gen(function* () {
          const list = yield* call("/plugin/demo/issue/42?x=1")
          expect(list.status).toBe(200)
          expect(yield* json(list)).toEqual({ id: "42", path: "/issue/42", query: { x: "1" }, method: "GET" })

          const denied = yield* call("/plugin/demo/webhook", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: "hi" }),
          })
          expect(denied.status).toBe(401)

          const bad = yield* call("/plugin/demo/webhook", {
            method: "POST",
            headers: { "content-type": "application/json", "x-webhook-secret": "s3cret" },
            body: JSON.stringify({}),
          })
          expect(bad.status).toBe(400)

          const accepted = yield* call("/plugin/demo/webhook", {
            method: "POST",
            headers: { "content-type": "application/json", "x-webhook-secret": "s3cret" },
            body: JSON.stringify({ text: "fix it" }),
          })
          expect(accepted.status).toBe(202)
          expect(yield* json(accepted)).toEqual({ sessionID: "created" })

          const reused = yield* call("/plugin/demo/webhook", {
            method: "POST",
            headers: { "content-type": "application/json", "x-webhook-secret": "s3cret" },
            body: JSON.stringify({ text: "again", sessionID: "ses_existing" }),
          })
          expect(yield* json(reused)).toEqual({ sessionID: "ses_existing" })
        }),
      )
    }),
  )

  it.live("returns 404 for unknown plugin, path or method", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const call = app(
        directory,
        mockPlugin([
          {
            id: "demo",
            routes: [{ method: "GET", path: "/ping", handler: async () => ({ body: { pong: true } }) }],
          },
        ]),
      )
      return yield* provideInstance(directory)(
        Effect.gen(function* () {
          expect((yield* call("/plugin/other/ping")).status).toBe(404)
          expect((yield* call("/plugin/demo/missing")).status).toBe(404)
          expect((yield* call("/plugin/demo/ping", { method: "POST" })).status).toBe(404)
        }),
      )
    }),
  )

  it.live("isolates handler failures and honors response shapes", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const call = app(
        directory,
        mockPlugin([
          {
            id: "demo",
            routes: [
              { method: "GET", path: "/boom", handler: async () => { throw new Error("boom") } },
              { method: "GET", path: "/empty", handler: async () => ({}) },
              { method: "GET", path: "/text", handler: async () => ({ body: "plain" }) },
            ],
          },
        ]),
      )
      return yield* provideInstance(directory)(
        Effect.gen(function* () {
          const boom = yield* call("/plugin/demo/boom")
          expect(boom.status).toBe(500)
          expect(((yield* json(boom)) as { error: string }).error).toContain("boom")

          expect((yield* call("/plugin/demo/empty")).status).toBe(204)

          const textResponse = yield* call("/plugin/demo/text")
          expect(textResponse.status).toBe(200)
          expect(textResponse.headers.get("content-type")).toContain("text/plain")
          expect(yield* text(textResponse)).toBe("plain")
        }),
      )
    }),
  )

  it.live("serves routes from a plugin loaded from a file", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const file = path.join(directory, "plugin.ts")
      const href = pathToFileURL(file).href
      yield* Effect.promise(() =>
        Bun.write(
          file,
          [
            "export default {",
            '  id: "webhook-plugin",',
            "  server: async () => ({",
            "    routes: [",
            "      {",
            '        method: "GET",',
            '        path: "/ping",',
            "        handler: async () => ({ status: 200, body: { pong: true } }),",
            "      },",
            "    ],",
            "  }),",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const config = TestConfig.layer({
        get: () =>
          Effect.succeed({
            plugin: [href],
            plugin_origins: [{ spec: href, source: file, scope: "local" as const }],
          }),
        directories: () => Effect.succeed([directory]),
      })
      const handler = HttpRouter.toWebHandler(
        PluginRoutesDispatcher.layer.pipe(
          Layer.provide(LayerNode.compile(Plugin.node, [
            [Config.node, config],
            [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
          ])),
          Layer.provide(testInstanceStoreLayer),
          Layer.provide(spawnerLayer),
          Layer.provide(HttpServer.layerServices),
        ) as unknown as Layer.Layer<never>,
        { disableLogger: true },
      ).handler
      return yield* provideInstance(directory)(
        Effect.promise(() =>
          handler(
            new Request("http://localhost/plugin/webhook-plugin/ping", {
              headers: { "x-opencode-directory": directory },
            }),
            Context.makeUnsafe(new Map()),
          ),
        ).pipe(
          Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))),
          Effect.flatMap((response) => Effect.promise(() => response.json() as Promise<{ pong: boolean }>)),
          Effect.map((body) => expect(body).toEqual({ pong: true })),
        ),
      )
    }),
  )
})
