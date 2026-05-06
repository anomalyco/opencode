import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Queue } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import Http from "node:http"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { registerAdapter } from "../../src/control-plane/adapters"
import { WorkspaceID } from "../../src/control-plane/schema"
import type { WorkspaceAdapter } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Project } from "../../src/project/project"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/groups/workspace"
import {
  WorkspaceRouteContext,
  workspaceRouterMiddleware,
} from "../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
    yield* Effect.promise(() => resetDatabase())
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
        await resetDatabase()
      }),
    )
  }),
)

const it = testEffect(
  Layer.mergeAll(
    testStateLayer,
    NodeHttpServer.layerTest,
    NodeServices.layer,
    Project.defaultLayer,
    Workspace.defaultLayer,
    Socket.layerWebSocketConstructorGlobal,
  ),
)

type ProxiedRequest = {
  url: string
  method: string
  headers: Record<string, string>
}

type TestHandler<E, R> = (
  request: HttpServerRequest.HttpServerRequest,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>

const workspaceRoutingTestLayer = workspaceRouterMiddleware.layer.pipe(
  Layer.provide([Socket.layerWebSocketConstructorGlobal, FetchHttpClient.layer]),
)

const serverUrl = HttpServer.HttpServer.use((server) => Effect.succeed(HttpServer.formatAddress(server.address)))

const requestURL = (request: { readonly url: string }) => new URL(request.url, "http://localhost")

const listenAdditionalServer = <E, R>(handler: TestHandler<E, R>) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
    const server = Context.get(context, HttpServer.HttpServer)
    yield* server.serve(HttpServerRequest.HttpServerRequest.use(handler))
    return HttpServer.formatAddress(server.address)
  })

const localAdapter = (directory: string): WorkspaceAdapter => ({
  name: "Local Test",
  description: "Create a local test workspace",
  configure: (info) => ({ ...info, name: "local-test", directory }),
  create: async () => {
    await mkdir(directory, { recursive: true })
  },
  async remove() {},
  target: () => ({ type: "local" as const, directory }),
})

const remoteAdapter = (directory: string, url: string, headers?: HeadersInit): WorkspaceAdapter => ({
  name: "Remote Test",
  description: "Create a remote test workspace",
  configure: (info) => ({ ...info, name: "remote-test", directory }),
  create: async () => {
    await mkdir(directory, { recursive: true })
  },
  async remove() {},
  target: () => ({ type: "remote" as const, url, headers }),
})

const eventStreamResponse = () =>
  HttpServerResponse.text('data: {"payload":{"type":"server.connected","properties":{}}}\n\n', {
    contentType: "text/event-stream",
  })

const syncResponse = (request: HttpServerRequest.HttpServerRequest) => {
  const url = requestURL(request)
  if (url.pathname === "/base/global/event") return Effect.succeed(eventStreamResponse())
  if (url.pathname === "/base/sync/history") return HttpServerResponse.json([])
  return undefined
}

const createWorkspace = (input: { projectID: Project.Info["id"]; type: string; adapter: WorkspaceAdapter }) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      registerAdapter(input.projectID, input.type, input.adapter)
      const workspace = yield* Workspace.Service
      return yield* workspace.create({
        type: input.type,
        branch: null,
        extra: null,
        projectID: input.projectID,
      })
    }),
    (info) => Workspace.Service.use((workspace) => workspace.remove(info.id)).pipe(Effect.ignore),
  )

const createRemoteWorkspace = (input: {
  dir: string
  projectID: Project.Info["id"]
  type: string
  url: string
  headers?: HeadersInit
}) =>
  // Workspace.create starts the remote sync loop. The test upstream exposes
  // /global/event and /sync/history so middleware proxying sees the remote
  // workspace as active, just like production would.
  createWorkspace({
    projectID: input.projectID,
    type: input.type,
    adapter: remoteAdapter(path.join(input.dir, `.${input.type}`), input.url, input.headers),
  })

const createLocalWorkspace = (input: { projectID: Project.Info["id"]; type: string; directory: string }) =>
  createWorkspace({
    projectID: input.projectID,
    type: input.type,
    adapter: localAdapter(input.directory),
  })

const insertRemoteWorkspaceWithoutSync = (input: {
  dir: string
  projectID: Project.Info["id"]
  type: string
  url: string
}) =>
  Effect.sync(() => {
    const id = WorkspaceID.ascending()
    registerAdapter(input.projectID, input.type, remoteAdapter(path.join(input.dir, `.${input.type}`), input.url))
    Database.use((db) => db.insert(WorkspaceTable).values({ id, type: input.type, project_id: input.projectID }).run())
    return id
  })

const startRemoteWorkspaceHttpServer = <E, R>(
  handler: (request: ProxiedRequest) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  listenAdditionalServer((request) =>
    Effect.gen(function* () {
      // Remote workspaces run a sync loop against their target server. These
      // bootstrap routes make Workspace.isSyncing(...) true for proxy tests;
      // everything else is the request being proxied by the middleware.
      const sync = syncResponse(request)
      if (sync) return yield* sync
      return yield* handler({ url: request.url, method: request.method, headers: request.headers })
    }),
  )

const listenRemoteWebSocket = () =>
  listenAdditionalServer((request) => {
    const sync = syncResponse(request)
    if (sync) return sync
    if (requestURL(request).pathname !== "/base/probe") return Effect.succeed(HttpServerResponse.empty({ status: 404 }))
    return echoWebSocket(request)
  })

const echoWebSocket = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const socket = yield* Effect.orDie(request.upgrade)
    const write = yield* socket.writer
    yield* socket
      .runRaw((message) => write(`echo:${String(message)}`), {
        onOpen: write(`protocol:${request.headers["sec-websocket-protocol"] ?? "none"}`).pipe(
          Effect.catch(() => Effect.void),
        ),
      })
      .pipe(Effect.catch(() => Effect.void))
    return HttpServerResponse.empty()
  })

const serveRouteContextProbe = HttpRouter.add(
  "GET",
  "/probe",
  Effect.gen(function* () {
    // The fake route exposes the context installed by the middleware, so tests
    // can assert routing decisions without pulling in the production API tree.
    const route = yield* WorkspaceRouteContext
    return yield* HttpServerResponse.json({ directory: route.directory, workspaceID: route.workspaceID })
  }),
).pipe(Layer.provide(workspaceRoutingTestLayer), HttpRouter.serve, Layer.build)

describe("HttpApi workspace routing middleware", () => {
  it.live("proxies remote workspace HTTP requests through the selected workspace target", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const project = yield* Project.use.fromDirectory(dir)
      let forwarded: ProxiedRequest | undefined

      // This starts a second HTTP server that stands in for the opencode server
      // backing a remote workspace. The client below still calls the local test
      // server; only the middleware should call this server.
      const remoteUrl = yield* startRemoteWorkspaceHttpServer((request) => {
        forwarded = request
        const url = requestURL(request)
        return HttpServerResponse.json(
          {
            proxied: true,
            path: url.pathname,
            keep: url.searchParams.get("keep"),
            workspace: url.searchParams.get("workspace"),
          },
          { status: 201, headers: { "x-remote": "yes" } },
        )
      })
      // The adapter target tells the middleware where to proxy selected remote
      // workspace requests. Appending /probe to this base should produce
      // `${remoteUrl}/base/probe` on the fake remote server above.
      const workspace = yield* createRemoteWorkspace({
        dir,
        projectID: project.project.id,
        type: "remote-http-target",
        url: `${remoteUrl}/base`,
        headers: { "x-target-auth": "secret" },
      })

      // The local /probe handler should not run. Selecting a remote workspace
      // should make the middleware call HttpApiProxy.http instead.
      yield* HttpRouter.add("PATCH", "/probe", HttpServerResponse.text("route called")).pipe(
        Layer.provide(workspaceRoutingTestLayer),
        HttpRouter.serve,
        Layer.build,
      )

      const response = yield* HttpClientRequest.patch(`/probe?workspace=${workspace.id}&keep=yes`).pipe(
        HttpClientRequest.setHeaders({
          "content-type": "application/json",
          "x-opencode-directory": "/secret/path",
          "x-opencode-workspace": "internal",
        }),
        HttpClient.execute,
      )

      expect(response.status).toBe(201)
      expect(response.headers["x-remote"]).toBe("yes")
      expect(yield* response.json).toEqual({ proxied: true, path: "/base/probe", keep: "yes", workspace: null })
      const forwardedURL = forwarded ? requestURL(forwarded) : undefined
      // These assertions are the routing contract: append the original path to
      // the remote base URL, preserve normal query params, and remove workspace.
      expect(forwardedURL?.pathname).toBe("/base/probe")
      expect(forwardedURL?.searchParams.get("keep")).toBe("yes")
      expect(forwardedURL?.searchParams.get("workspace")).toBeNull()
      expect(forwarded?.method).toBe("PATCH")
      expect(forwarded?.headers["content-type"]).toBe("application/json")
      expect(forwarded?.headers["x-target-auth"]).toBe("secret")
      expect(forwarded?.headers["x-opencode-directory"]).toBeUndefined()
      expect(forwarded?.headers["x-opencode-workspace"]).toBeUndefined()
    }),
  )

  it.live("returns 503 when a remote workspace is not actively syncing", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const project = yield* Project.use.fromDirectory(dir)
      const workspaceID = yield* insertRemoteWorkspaceWithoutSync({
        dir,
        projectID: project.project.id,
        type: "remote-not-syncing",
        url: "http://127.0.0.1:1/base",
      })

      yield* HttpRouter.add("GET", "/probe", HttpServerResponse.text("route called")).pipe(
        Layer.provide(workspaceRoutingTestLayer),
        HttpRouter.serve,
        Layer.build,
      )

      const response = yield* HttpClient.get(`/probe?workspace=${workspaceID}`)

      expect(response.status).toBe(503)
      expect(yield* response.text).toBe(`broken sync connection for workspace: ${workspaceID}`)
    }),
  )

  it.live("proxies remote workspace WebSocket requests through the selected workspace target", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const project = yield* Project.use.fromDirectory(dir)
      const remoteUrl = yield* listenRemoteWebSocket()
      const workspace = yield* createRemoteWorkspace({
        dir,
        projectID: project.project.id,
        type: "remote-websocket-target",
        url: `${remoteUrl}/base`,
      })

      // The client connects to the local test server. The middleware should
      // detect the WebSocket upgrade and proxy it to the remote /base/probe.
      yield* HttpRouter.add("GET", "/probe", HttpServerResponse.text("route called")).pipe(
        Layer.provide(workspaceRoutingTestLayer),
        HttpRouter.serve,
        Layer.build,
      )

      const socket = yield* Socket.makeWebSocket(
        `${(yield* serverUrl).replace(/^http/, "ws")}/probe?workspace=${workspace.id}`,
        {
          closeCodeIsError: () => false,
          protocols: "chat",
        },
      )
      const messages = yield* Queue.unbounded<string>()
      yield* socket.runRaw((message) => Queue.offer(messages, String(message))).pipe(Effect.forkScoped)
      const write = yield* socket.writer

      expect(yield* Queue.take(messages)).toBe("protocol:chat")
      yield* write("hello")
      expect(yield* Queue.take(messages)).toBe("echo:hello")
    }),
  )

  it.live("returns a missing workspace response for unknown workspace ids", () =>
    Effect.gen(function* () {
      const workspaceID = WorkspaceID.ascending("wrk_missing")
      // If the middleware resolves the workspace first, this handler is never
      // reached and the response should be the middleware error response.
      yield* HttpRouter.add("GET", "/probe", HttpServerResponse.text("route called")).pipe(
        Layer.provide(workspaceRoutingTestLayer),
        HttpRouter.serve,
        Layer.build,
      )

      const response = yield* HttpClient.get(`/probe?workspace=${workspaceID}`)

      expect(response.status).toBe(500)
      expect(yield* response.text).toBe(`Workspace not found: ${workspaceID}`)
    }),
  )

  it.live("keeps control-plane routes local even when workspace is selected", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const project = yield* Project.use.fromDirectory(dir)

      const workspaceDir = path.join(dir, ".workspace-local")
      const workspace = yield* createLocalWorkspace({
        projectID: project.project.id,
        type: "control-plane-target",
        directory: workspaceDir,
      })

      // GET /session is a control-plane route: it lists sessions for the main
      // process and should not be redirected into the selected workspace target.
      yield* HttpRouter.add(
        "GET",
        "/session",
        Effect.gen(function* () {
          const route = yield* WorkspaceRouteContext
          return yield* HttpServerResponse.json({ directory: route.directory, workspaceID: route.workspaceID })
        }),
      ).pipe(Layer.provide(workspaceRoutingTestLayer), HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get(`/session?workspace=${workspace.id}`)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ directory: process.cwd(), workspaceID: workspace.id })
    }),
  )

  it.live("keeps workspace control routes local even when workspace is selected", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const project = yield* Project.use.fromDirectory(dir)
      const workspaceDir = path.join(dir, ".workspace-local")
      const workspace = yield* createLocalWorkspace({
        projectID: project.project.id,
        type: "workspace-control-plane-target",
        directory: workspaceDir,
      })

      // Workspace CRUD/status routes manage the control plane itself. Selecting
      // a workspace should preserve the selected id for handlers, but must not
      // swap the route context to the workspace target directory.
      yield* HttpRouter.add(
        "GET",
        WorkspacePaths.list,
        Effect.gen(function* () {
          const route = yield* WorkspaceRouteContext
          return yield* HttpServerResponse.json({ directory: route.directory, workspaceID: route.workspaceID })
        }),
      ).pipe(Layer.provide(workspaceRoutingTestLayer), HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get(`${WorkspacePaths.list}?workspace=${workspace.id}`)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ directory: process.cwd(), workspaceID: workspace.id })
    }),
  )

  it.live("uses directory query/header fallback when no workspace is selected", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const queryDir = path.join(dir, "query-target")
      const headerDir = path.join(dir, "header-target")
      yield* serveRouteContextProbe

      // Without a selected workspace, the middleware falls back to request
      // directory hints before using the process cwd.
      const queryResponse = yield* HttpClient.get(`/probe?directory=${encodeURIComponent(queryDir)}`)
      const headerResponse = yield* HttpClientRequest.get("/probe").pipe(
        HttpClientRequest.setHeader("x-opencode-directory", headerDir),
        HttpClient.execute,
      )

      expect(queryResponse.status).toBe(200)
      expect(yield* queryResponse.json).toEqual({ directory: queryDir })
      expect(headerResponse.status).toBe(200)
      expect(yield* headerResponse.json).toEqual({ directory: headerDir })
    }),
  )

  it.live("routes local workspace requests through WorkspaceRouteContext", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const project = yield* Project.use.fromDirectory(dir)

      const workspaceDir = path.join(dir, ".workspace-local")
      const workspace = yield* createLocalWorkspace({
        projectID: project.project.id,
        type: "local-target",
        directory: workspaceDir,
      })

      yield* serveRouteContextProbe

      // /probe is not a control-plane route, so selecting a local workspace
      // should swap the route context to the workspace target directory.
      const response = yield* HttpClient.get(`/probe?workspace=${workspace.id}`)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        directory: workspaceDir,
        workspaceID: workspace.id,
      })
    }),
  )
})
