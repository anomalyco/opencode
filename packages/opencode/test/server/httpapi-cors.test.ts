import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { Server } from "../../src/server/server"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
      OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
    }
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
        Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
        await resetDatabase()
      }),
    )
  }),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  ExperimentalHttpApiServer.routes,
  { disableListenLog: true, disableLogger: true },
)

const it = testEffect(
  Layer.mergeAll(
    testStateLayer,
    servedRoutes.pipe(
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
)

describe("HttpApi CORS", () => {
  it.live("allows browser preflight requests without credentials", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.options(InstancePaths.path).pipe(
        HttpClientRequest.setHeaders({
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        }),
        HttpClient.execute,
      )

      expect(response.status).toBe(204)
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000")
      expect(response.headers["access-control-allow-headers"]).toBe("authorization")
    }),
  )

  it.live("uses custom CORS origins passed to the server", () =>
    Effect.gen(function* () {
      const listener = yield* Effect.acquireRelease(
        Effect.promise(() => Server.listen({ hostname: "127.0.0.1", port: 0, cors: ["https://custom.example"] })),
        (listener) => Effect.promise(() => listener.stop(true)),
      )

      const response = yield* Effect.promise(() =>
        fetch(new URL(InstancePaths.path, listener.url), {
          method: "OPTIONS",
          headers: {
            origin: "https://custom.example",
            "access-control-request-method": "GET",
            "access-control-request-headers": "authorization",
          },
        }),
      )

      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("https://custom.example")
      expect(response.headers.get("access-control-allow-headers")).toBe("authorization")
    }),
  )
})
