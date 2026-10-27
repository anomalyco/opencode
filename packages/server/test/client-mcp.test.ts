import { expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Mcp } from "@opencode/core/mcp/index"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { Context, Effect, Exit, Layer, Schedule, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { createServer } from "node:http"
import path from "node:path"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"
import { createRoutes } from "../src/routes"

// The DOM lib hides Bun's WebSocket constructor overload that accepts upgrade request headers.
declare const WebSocket: {
  new (url: string | URL, options?: Bun.WebSocketOptions): globalThis.WebSocket
}

const authorization = `Basic ${btoa("opencode:secret")}`

const serve = Effect.fnUntraced(function* () {
  const directory = (yield* tmpdirScoped("opencode-client-mcp-")).path
  const context = yield* Layer.build(
    createRoutes({
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
      models: { fetch: false },
      config: { directory, project: false, content: "{}" },
      fs: { filewatcher: false },
    }).pipe(Layer.provideMerge(NodeHttpServer.layerHttpServices)),
  )
  const server = createServer()
  const http = yield* NodeHttpServer.make(() => server, { port: 0, host: "127.0.0.1" })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))
  yield* http
    .serve(Context.get(context, HttpRouter.HttpRouter).asHttpEffect())
    .pipe(Effect.provide(NodeHttpServer.layerHttpServices))
  const base = HttpServer.formatAddress(http.address)
  const location = LocationServiceMap.Service.get(
    LocationServiceMap.canonical(Location.Ref.make({ directory: directory as Location.Ref["directory"] })),
  )
  return {
    base,
    directory,
    url: (query: Record<string, string>) => {
      const url = new URL("/api/experimental/client-mcp", base)
      url.protocol = "ws:"
      url.searchParams.set("location[directory]", directory)
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
      return url
    },
    inLocation: <A, E>(effect: Effect.Effect<A, E, Mcp.Service | Tool.Service | McpTool.Service>) =>
      effect.pipe(Effect.provide(location), Effect.provideContext(context)),
  }
})

/** Hosts an MCP server over a WebSocket opened to the endpoint, recording each call's session. */
const connectClient = (url: URL, headers?: Record<string, string>) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const socket = new WebSocket(url, { headers })
      const state = { open: false, initialized: false, closed: false, code: 0 }
      const sessions: unknown[] = []
      const reply = (id: unknown, result: unknown) => socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }))
      socket.addEventListener("open", () => {
        state.open = true
      })
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data))
        if (message.method === "initialize")
          return reply(message.id, {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "test-client", version: "1.0.0" },
          })
        if (message.method === "notifications/initialized") {
          state.initialized = true
          return
        }
        if (message.method === "tools/list")
          return reply(message.id, {
            tools: [{ name: "open_terminal", description: "Open a terminal", inputSchema: { type: "object" } }],
          })
        if (message.method === "tools/call") {
          sessions.push(message.params._meta?.["ai.opencode/sessionID"])
          return reply(message.id, { content: [{ type: "text", text: "opened" }] })
        }
        if (message.id !== undefined && message.method) reply(message.id, {})
      })
      socket.addEventListener("close", (event) => {
        state.closed = true
        state.code = event.code
      })
      return { socket, state, sessions }
    }),
    (client) => Effect.sync(() => client.socket.close()),
  )

const until = (check: () => boolean | Promise<boolean>) =>
  Effect.promise(async () => check()).pipe(
    Effect.flatMap((done) => (done ? Effect.void : Effect.fail("pending"))),
    Effect.retry({ times: 500, schedule: Schedule.spaced("10 millis") }),
    Effect.orDie,
  )

const registryIDs = Effect.gen(function* () {
  const registration = yield* McpTool.Service
  yield* registration.flush
  const registry = yield* Tool.Service
  return (yield* registry.list()).map((tool) => tool.id)
})

it.live(
  "attaches a client MCP server for the lifetime of its socket",
  () =>
    Effect.gen(function* () {
      const server = yield* serve()
      const client = yield* connectClient(server.url({ name: "tui" }), { authorization })
      const tools = () => Effect.runPromise(server.inLocation(Mcp.Service.use((mcp) => mcp.tools())))

      yield* until(async () => (await tools()).length > 0)
      expect((yield* Effect.promise(tools)).map((tool) => [tool.server, tool.name])).toEqual([["tui", "open_terminal"]])
      yield* until(() =>
        Effect.runPromise(server.inLocation(registryIDs)).then((ids) => ids.includes("tui_open_terminal")),
      )

      const call = (sessionID: string) =>
        Effect.runPromise(
          server.inLocation(
            Mcp.Service.use((mcp) =>
              mcp.callTool({ server: "tui", name: "open_terminal", sessionID: Session.ID.make(sessionID) }),
            ),
          ),
        )
      const result = yield* Effect.promise(() => call("ses_client_mcp"))
      expect(result.content).toEqual([{ type: "text", text: "opened" }])
      expect(client.sessions).toEqual(["ses_client_mcp"])

      // A second client with the same name stacks on top: it takes the calls while the first stays open.
      const newer = yield* connectClient(server.url({ name: "tui" }), { authorization })
      yield* until(() => call("ses_newer").then(() => newer.sessions.length > 0))
      expect(newer.sessions.every((session) => session === "ses_newer")).toBeTrue()
      expect(client.state.closed).toBeFalse()

      // Once the newest closes, calls fall back to the earlier client.
      const before = client.sessions.length
      newer.socket.close()
      yield* until(() => newer.state.closed)
      yield* until(() =>
        call("ses_fallback").then(
          () => client.sessions.length > before,
          () => false,
        ),
      )
      expect(client.sessions.at(-1)).toBe("ses_fallback")

      client.socket.close()
      yield* until(async () => (await tools()).length === 0)
      yield* until(() =>
        Effect.runPromise(server.inLocation(registryIDs)).then((ids) => !ids.includes("tui_open_terminal")),
      )
    }),
  20_000,
)

it.live(
  "accepts a single-use ticket instead of credentials",
  () =>
    Effect.gen(function* () {
      const server = yield* serve()
      const requestToken = (name: string, headers: Record<string, string>) => {
        const url = new URL("/api/experimental/client-mcp/token", server.base)
        url.searchParams.set("location[directory]", server.directory)
        url.searchParams.set("name", name)
        return fetch(url, { method: "POST", headers })
      }
      const token = (name: string) =>
        Effect.promise(async () => {
          const response = await requestToken(name, { authorization, "x-opencode-ticket": "1" })
          expect(response.status).toBe(200)
          return ((await response.json()) as { data: { ticket: string } }).data.ticket
        })

      // Without the preflight-forcing header, a ticket cannot be minted even with credentials.
      expect((yield* Effect.promise(() => requestToken("web", { authorization }))).status).toBe(403)

      const unauthenticated = yield* connectClient(server.url({ name: "web" }))
      yield* until(() => unauthenticated.state.closed)
      expect(unauthenticated.state.open).toBeFalse()

      const ticket = yield* token("web")
      const mismatched = yield* connectClient(server.url({ name: "other", ticket }))
      yield* until(() => mismatched.state.closed)
      expect(mismatched.state.open).toBeFalse()

      const otherDirectory = server.url({ name: "web", ticket: yield* token("web") })
      otherDirectory.protocol = "http:"
      otherDirectory.searchParams.set("location[directory]", path.join(server.directory, "other"))
      expect((yield* Effect.promise(() => fetch(otherDirectory))).status).toBe(403)

      const fresh = yield* token("web")
      const client = yield* connectClient(server.url({ name: "web", ticket: fresh }))
      yield* until(() =>
        Effect.runPromise(server.inLocation(Mcp.Service.use((mcp) => mcp.tools()))).then((tools) =>
          tools.some((tool) => tool.server === "web"),
        ),
      )
      expect(client.state.open).toBeTrue()

      const reused = yield* connectClient(server.url({ name: "web", ticket: fresh }))
      yield* until(() => reused.state.closed)
      expect(reused.state.open).toBeFalse()

      // The server's end of an accepted socket lives in the serving scope until the client disconnects.
      client.socket.close()
      yield* until(() => client.state.closed)
    }),
  20_000,
)

it.live(
  "rejects an invalid client name",
  () =>
    Effect.gen(function* () {
      const server = yield* serve()
      const url = server.url({ name: "bad name!" })
      url.protocol = "http:"
      const response = yield* Effect.promise(() => fetch(url, { headers: { authorization } }))
      expect(response.status).toBe(400)

      const client = yield* connectClient(server.url({ name: "bad.name" }), { authorization })
      yield* until(() => client.state.closed)
      expect(client.state.open).toBeFalse()
    }),
  20_000,
)

it.live(
  "closes with 1011 when the client rejects initialize",
  () =>
    Effect.gen(function* () {
      const server = yield* serve()
      const state = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const socket = new WebSocket(server.url({ name: "tui" }), { headers: { authorization } })
          const state = { socket, closed: false, code: 0 }
          socket.addEventListener("message", (event) => {
            const message = JSON.parse(String(event.data))
            if (message.method !== "initialize") return
            socket.send(
              JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "not today" } }),
            )
          })
          socket.addEventListener("close", (event) => {
            state.closed = true
            state.code = event.code
          })
          return state
        }),
        (state) => Effect.sync(() => state.socket.close()),
      )
      yield* until(() => state.closed)
      expect(state.code).toBe(1011)
    }),
  20_000,
)

it.live(
  "shuts the server down while a client is attached",
  () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped("opencode-client-mcp-")).path
      // Released before the directory so the server lets go of it first; closing twice is a no-op.
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
      const server = yield* ServerProcess.start<never, never>(
        {
          hostname: "127.0.0.1",
          port: 0,
          password: "secret",
          app: { version: "test-version" },
          database: { path: ":memory:" },
          models: { fetch: false },
          config: { directory, project: false, content: "{}" },
          fs: { filewatcher: false },
        },
        { onListen: () => Effect.succeed(Effect.void) },
      ).pipe(Scope.provide(scope))
      const url = new URL("/api/experimental/client-mcp", HttpServer.formatAddress(server.address))
      url.protocol = "ws:"
      url.searchParams.set("location[directory]", directory)
      url.searchParams.set("name", "tui")
      const client = yield* connectClient(url, { authorization })
      yield* until(() => client.state.initialized)

      const closed = yield* Scope.close(scope, Exit.void).pipe(Effect.timeoutOption("5 seconds"))
      expect(closed._tag).toBe("Some")
      yield* until(() => client.state.closed)
    }),
  20_000,
)
