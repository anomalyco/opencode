import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { PluginInvoke } from "@opencode-ai/core/plugin/invoke"
import { PluginGroup } from "@opencode-ai/protocol/groups/plugin"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { PluginHandler } from "@opencode-ai/server/handlers/plugin"
import { schemaErrorLayer } from "@opencode-ai/server/middleware/schema-error"
import { LocationMiddleware } from "@opencode-ai/server/location"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { testEffect } from "../lib/effect"

const registry = new Map<string, Map<string, PluginInvoke.Handler>>()

const pluginInvokeStub = Layer.succeed(
  PluginInvoke.Service,
  PluginInvoke.Service.of({
    register: () => Effect.die("plugin invoke test stub does not support register"),
    invoke: (pluginID, name, input) => {
      const names = registry.get(pluginID)
      if (!names) return Effect.fail(new PluginInvoke.UnknownPluginError({ pluginID }))
      const handler = names.get(name)
      if (!handler) return Effect.fail(new PluginInvoke.UnknownInvokeError({ pluginID, name }))
      return handler(input)
    },
    list: () => [...registry.entries()].map(([id, names]) => ({ id, invokes: [...names.keys()] })),
  }),
)

// ponytail: passthrough stubs for the production middleware keys the handler layer carries;
// the handler's real requirements come from the router context.
const authStub = Layer.succeed(
  Authorization,
  Authorization.of((effect) => effect),
)
const locationStub = Layer.succeed(
  LocationMiddleware,
  LocationMiddleware.of(
    (effect) => effect as unknown as Effect.Effect<HttpServerResponse.HttpServerResponse, never, never>,
  ),
)

const testApi = HttpApi.make("server").add(PluginGroup).middleware(SchemaErrorMiddleware)

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(testApi).pipe(
    Layer.provide(PluginHandler),
    Layer.provide(schemaErrorLayer),
    Layer.provide(pluginInvokeStub),
    Layer.provide(authStub),
    Layer.provide(locationStub),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(NodeServices.layer))

const it = testEffect(apiLayer)

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function register(pluginID: string, name: string, handler: PluginInvoke.Handler) {
  const names = registry.get(pluginID) ?? new Map()
  names.set(name, handler)
  registry.set(pluginID, names)
}

afterEach(() => {
  registry.clear()
})

describe("plugin HttpApi", () => {
  it.live("returns empty data when no plugins are registered", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/plugin")
      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ data: [] })
    }),
  )

  it.live("lists registered plugins", () =>
    Effect.gen(function* () {
      register("demo", "echo", (input) => Effect.succeed({ echoed: input }))
      const response = yield* request("/api/plugin")
      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ data: [{ id: "demo", invokes: ["echo"] }] })
    }),
  )

  it.live("invokes a registered plugin function", () =>
    Effect.gen(function* () {
      register("demo", "echo", (input) => Effect.succeed({ echoed: input }))
      const response = yield* request("/api/plugin/demo/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "echo", input: { hello: "world" } }),
      })
      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ result: { echoed: { hello: "world" } } })
    }),
  )

  it.live("returns 404 when the plugin is unknown", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/plugin/missing/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "echo", input: null }),
      })
      expect(response.status).toBe(404)
      expect(yield* response.json).toEqual({ _tag: "PluginNotFoundError", message: "Plugin not found: missing" })
    }),
  )

  it.live("returns 404 when the invoke is unknown", () =>
    Effect.gen(function* () {
      register("demo", "echo", (input) => Effect.succeed(input))
      const response = yield* request("/api/plugin/demo/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "nope", input: null }),
      })
      expect(response.status).toBe(404)
      expect(yield* response.json).toEqual({
        _tag: "PluginInvokeNotFoundError",
        pluginID: "demo",
        name: "nope",
        message: "Invoke not found: demo/nope",
      })
    }),
  )

  it.live("returns 400 for a malformed invoke body", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/plugin/demo/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: null }),
      })
      expect(response.status).toBe(400)
      const body = (yield* response.json) as { _tag: string }
      expect(body._tag).toBe("InvalidRequestError")
    }),
  )
})
