import path from "node:path"
import { expect } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { OpenCode, type SessionMessageInfo } from "@opencode/client"
import { Bus } from "@opencode/core/bus"
import { Permission } from "@opencode/core/permission"
import { Agent } from "@opencode/core/agent"
import { Instance } from "@opencode/core/instance"
import { Mcp } from "@opencode/core/mcp/index"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionMessage } from "@opencode/schema/session-message"
import { Global } from "@opencode/util/global"
import { Context, Deferred, Effect, Fiber, FileSystem, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { waitForCodeModeTool } from "../../core/test/lib/tool"
import { createEmbeddedRoutes } from "../../server/src/routes"

for (const mode of ["live", "hydrated", "stale", "parallel"] as const) {
  it.live(`real Code Mode MCP asks reach the TUI and settle through HTTP (${mode})`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const context = yield* Layer.build(
        createEmbeddedRoutes(
          {
            app: { version: "test" },
            database: { path: ":memory:" },
            config: { project: false },
            models: { fetch: false },
            fs: { filewatcher: false },
          },
          [Global.node.replace(tempGlobalLayer)],
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const listed = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let sessionID: string | undefined
      let held = false
      yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            idleTimeout: 0,
            fetch: async (request) => {
              const response = await handler(request)
              if (
                mode === "stale" &&
                !held &&
                request.method === "GET" &&
                new URL(request.url).pathname === `/api/session/${sessionID}/permission`
              ) {
                // Delay a real snapshot; no permission payload or SSE event is fabricated.
                held = true
                listed.resolve()
                await release.promise
              }
              return response
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const api = OpenCode.make({ baseUrl: server.url.toString() })
      // Import the outer tool transcript to test transport and UI without an LLM.
      // Execution below still uses the real session Instance, Code Mode runtime and stdio MCP.
      const code =
        mode === "parallel"
          ? "return await Promise.all([tools.local.echo({}), tools.local.echo({})])"
          : "return await tools.local.echo({})"
      const messages: SessionMessageInfo[] = [
        { id: "msg_user", type: "user", text: "Run local echo", time: { created: 0 } },
        {
          id: "msg_execute",
          type: "assistant",
          agent: "build",
          model: { providerID: "demo", id: "demo-model" },
          content: [
            {
              type: "tool",
              id: "call_outer",
              name: "execute",
              state: {
                status: "running",
                input: { code },
                metadata: { toolCalls: [{ tool: "local.echo", status: "running" }] },
              },
              time: { created: 1, ran: 1 },
            },
          ],
          time: { created: 1 },
        },
      ]

      const imported = yield* Effect.promise(async () => {
        const template = await api.session.create({ title: "MCP routing", location: { directory: directory.path } })
        return api.session.import({
          location: { directory: directory.path },
          info: { ...template, id: Session.ID.create() },
          messages,
        })
      })
      const sessions = Context.get(context, Session.Service)
      const session = yield* sessions.get(Session.ID.make(imported.id))
      sessionID = session.id
      expect(session.location.directory).toBe(AbsolutePath.make(directory.path))
      const instances = Context.get(context, Instance.Service)
      const snapshot = yield* Effect.gen(function* () {
        const agents = yield* Agent.Service
        yield* agents.transform((editor) =>
          editor.update(Agent.ID.make("build"), (value) => {
            value.permissions = [{ action: "local_*", resource: "*", effect: "ask" }]
          }),
        )
        const mcp = yield* Mcp.Service
        yield* mcp.add(
          "local",
          new ConfigMCP.Local({
            type: "local",
            command: [process.execPath, path.resolve(import.meta.dir, "../../core/test/fixture/mcp-permission.ts")],
          }),
        )
        return yield* waitForCodeModeTool(yield* Tool.Service, "local.echo")
      }).pipe(instances.provide(session))
      const asked = yield* Deferred.make<void>()
      const requests: Permission.Request[] = []
      const bus = Context.get(context, Bus.Service)
      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Permission.Event.Asked.type) return
          const request = event.data as Permission.Request
          if (request.sessionID !== session.id) return
          requests.push(request)
          if (requests.length === (mode === "parallel" ? 2 : 1)) yield* Deferred.succeed(asked, undefined)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const execute = snapshot
        .execute({
          sessionID: session.id,
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.make("msg_execute"),
          call: {
            type: "tool-call",
            id: "call_outer",
            name: "execute",
            input: { code },
          },
        })
        .pipe(instances.provide(session))
      const pending = mode === "hydrated" ? yield* execute.pipe(Effect.forkScoped) : undefined
      if (pending) yield* Deferred.await(asked).pipe(Effect.timeout("5 seconds"))
      const setup = yield* Effect.promise(() =>
        createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true }),
      )
      setup.renderer.start()
      const { run } = yield* Effect.promise(() => import("../src/app"))
      const task = Effect.runPromise(
        run({
          app: { name: "test", version: "test", channel: "test" },
          server: { endpoint: { url: server.url.toString() } },
          config: { get: async () => ({ animations: false, tabs: { mode: "off" } }), update: async () => ({}) },
          packages: { prepare: async () => ({ directory: "" }) },
          args: { sessionID: session.id },
          terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
          log: () => {},
        }).pipe(Effect.provide(Global.layerWith({ state: directory.path })), Effect.provide(FileSystem.layerNoop({}))),
      )
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          release.resolve()
          setup.renderer.destroy()
          await task
        }),
      )
      if (mode === "stale") yield* Effect.promise(() => listed.promise)
      else yield* Effect.promise(() => setup.waitForFrame((frame) => frame.includes("Run local echo")))
      const fiber = pending ?? (yield* execute.pipe(Effect.forkScoped))
      yield* Deferred.await(asked).pipe(Effect.timeout("5 seconds"))
      yield* Effect.promise(() =>
        setup.waitForFrame((frame) => frame.includes("local_echo") && frame.includes("Allow once")),
      )
      release.resolve()
      yield* Effect.promise(() => setup.waitForVisualIdle())
      expect(setup.captureCharFrame()).toContain("Allow once")
      expect(requests).toHaveLength(mode === "parallel" ? 2 : 1)
      for (const request of requests)
        expect(request.source).toEqual({ type: "tool", messageID: "msg_execute", id: "call_outer" })
      const response = yield* Effect.promise(() => fetch(new URL(`/api/session/${session.id}/permission`, server.url)))
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        data: requests.map(({ id, sessionID, action, source }) => ({ id, sessionID, action, source })),
      })
      setup.mockInput.pressEnter()
      if (mode === "parallel") {
        yield* Effect.promise(() =>
          setup.waitFor(async () => {
            const response = await fetch(new URL(`/api/session/${session.id}/permission`, server.url))
            return (await response.json()).data.length === 1
          }),
        )
        yield* Effect.promise(() => setup.waitForFrame((frame) => frame.includes("Allow once")))
        setup.mockInput.pressEnter()
      }
      const result = yield* Fiber.join(fiber).pipe(Effect.timeout("5 seconds"))
      expect(result.content).toEqual([
        {
          type: "text",
          text: mode === "parallel" ? '[\n  "echo completed",\n  "echo completed"\n]' : "echo completed",
        },
      ])
      const after = yield* Effect.promise(() => fetch(new URL(`/api/session/${session.id}/permission`, server.url)))
      expect(yield* Effect.promise(() => after.json())).toEqual({ data: [] })
    }),
  )
}
