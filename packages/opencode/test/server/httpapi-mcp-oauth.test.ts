import { NodeHttpServer } from "@effect/platform-node"
import { Session } from "@/session/session"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { McpApi, McpPaths } from "../../src/server/routes/instance/httpapi/groups/mcp"
import { Authorization } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "../../src/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { testEffect } from "../lib/effect"

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(McpApi)
const fakeSession = Layer.mock(Session.Service)({})
const testMcpHandlers = HttpApiBuilder.group(TestHttpApi, "mcp", (handlers) =>
  Effect.succeed(
    handlers
      .handle("status", () => Effect.die("unexpected MCP status"))
      .handle("add", () => Effect.die("unexpected MCP add"))
      .handle("authStart", () =>
        Effect.succeed({ authorizationUrl: "https://auth.example/start", oauthState: "state-123" }),
      )
      .handle("authCallback", () => Effect.die("unexpected MCP authCallback"))
      .handle("authAuthenticate", () => Effect.die("unexpected MCP authAuthenticate"))
      .handle("authRemove", () => Effect.die("unexpected MCP authRemove"))
      .handle("connect", () => Effect.die("unexpected MCP connect"))
      .handle("disconnect", () => Effect.die("unexpected MCP disconnect")),
  ),
)

const passthroughAuthorization = Layer.succeed(
  Authorization,
  Authorization.of((effect) => effect),
)

const passthroughInstanceContext = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) => effect),
)

const testWorkspaceRouting = Layer.succeed(
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingMiddleware.of((effect) =>
    effect.pipe(Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory: process.cwd() }))),
  ),
)

const it = testEffect(
  HttpRouter.serve(
    HttpApiBuilder.layer(TestHttpApi).pipe(
      Layer.provide(testMcpHandlers),
      Layer.provide([passthroughAuthorization, passthroughInstanceContext, testWorkspaceRouting, fakeSession]),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
)

describe("mcp HttpApi OAuth", () => {
  it.live("preserves oauth state when starting OAuth", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(McpPaths.auth.replace(":name", "demo")).pipe(HttpClient.execute)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        authorizationUrl: "https://auth.example/start",
        oauthState: "state-123",
      })
    }),
  )
})
