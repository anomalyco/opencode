import { expect } from "bun:test"
import { InMemoryTransport, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client"
import { McpServer } from "@modelcontextprotocol/server"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { McpEvent } from "@opencode/schema/mcp-event"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Image } from "@opencode/core/image"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Exit, Layer, Schedule, Scope, Stream } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { executeTool, toolIdentity } from "./lib/tool"

// Attached clients are never OAuth integrations.
const unused = () => Effect.die("unused integration service")

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node, Mcp.node, Bus.node]), [
    Location.node.replace(tempLocationLayer),
    Environment.node.replace(hostEnvironmentLayer),
    Integration.node.replace(
      Layer.mock(Integration.Service, {
        revision: () => 0,
        connection: {
          active: unused,
          resolve: unused,
          key: unused,
          external: unused,
          activate: unused,
          update: unused,
          remove: unused,
          status: unused,
        },
        oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
        command: { connect: unused, status: unused, cancel: unused },
      }),
    ),
    Credential.node.replace(Layer.mock(Credential.Service, {})),
    Permission.node.replace(Layer.mock(Permission.Service, { assert: () => Effect.void })),
    Image.node.replace(imagePassthrough),
  ]),
)

/** Starts an in-memory client MCP server whose tools answer with `label` and record the caller's session. */
const clientServer = (label: string, tools: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const server = new McpServer({ name: label, version: "1.0.0" })
    const sessions: Array<unknown> = []
    for (const tool of tools)
      server.registerTool(tool, { description: `${label} ${tool}` }, (ctx) => {
        sessions.push(ctx.mcpReq._meta?.["ai.opencode/sessionID"])
        return { content: [{ type: "text", text: `${label}:${tool}` }] }
      })
    const [client, transport] = InMemoryTransport.createLinkedPair()
    yield* Effect.acquireRelease(
      Effect.promise(() => server.connect(transport)),
      () => Effect.promise(() => server.close()),
    )
    return { server, client, sessions }
  })

/** Forwards a transport, answering `tools/list` with an error while `state.fail` is set. */
const failingList = (inner: Transport) => {
  const state = { fail: false }
  const transport: Transport = {
    start: () => inner.start(),
    close: () => inner.close(),
    send: async (message: JSONRPCMessage, options) => {
      if (!state.fail || !("method" in message) || message.method !== "tools/list" || !("id" in message))
        return inner.send(message, options)
      queueMicrotask(() =>
        transport.onmessage?.({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "list failed" } }),
      )
    },
  }
  inner.onmessage = (message, extra) => transport.onmessage?.(message, extra)
  inner.onclose = () => transport.onclose?.()
  inner.onerror = (error) => transport.onerror?.(error)
  return { transport, state }
}

const toolsChanged = Effect.gen(function* () {
  const bus = yield* Bus.Service
  const servers: string[] = []
  yield* bus.subscribe(McpEvent.ToolsChanged).pipe(
    Stream.runForEach((event) => Effect.sync(() => servers.push(event.data.server))),
    Effect.forkScoped({ startImmediately: true }),
  )
  return servers
})

const waitUntil = (check: () => boolean) =>
  Effect.suspend(() => (check() ? Effect.void : Effect.fail("pending"))).pipe(
    Effect.retry({ times: 500, schedule: Schedule.spaced("2 millis") }),
  )

/** Waits until the MCP tool registration has (or has not) settled on a registry id. */
const registered = (id: string, present = true) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    const registration = yield* McpTool.Service
    yield* registration.flush
    const ids = (yield* registry.list()).map((tool) => tool.id)
    if (ids.includes(id) !== present) return yield* Effect.fail("pending")
  }).pipe(Effect.retry({ times: 500, schedule: Schedule.spaced("2 millis") }))

// Attached tools use Code Mode by default, like any MCP server's tools.
const call = (path: string, sessionID = Session.ID.make("ses_client_mcp")) =>
  Effect.gen(function* () {
    return yield* executeTool(yield* Tool.Service, {
      sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_client_mcp",
        name: "execute",
        input: { code: `return await tools.${path}({})` },
      },
    })
  })

it.live("attaches a client MCP server and routes its tools with the session", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const changes = yield* toolsChanged
    const client = yield* clientServer("tui", ["open_terminal"])

    yield* mcp.attach("tui", client.client)
    yield* waitUntil(() => changes.includes("tui"))
    expect((yield* mcp.tools()).map((tool) => [tool.server, tool.name])).toEqual([["tui", "open_terminal"]])

    yield* registered("tui_open_terminal")
    const result = yield* call("tui.open_terminal", Session.ID.make("ses_attached"))
    expect(result.status).toBe("completed")
    expect(result.output?.output).toBe("tui:open_terminal")
    expect(client.sessions).toEqual(["ses_attached"])
  }),
)

it.live("removes an attached entry when its scope closes", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const changes = yield* toolsChanged
    const client = yield* clientServer("tui", ["open_terminal"])
    const scope = yield* Scope.make()

    yield* mcp.attach("tui", client.client).pipe(Scope.provide(scope))
    yield* registered("tui_open_terminal")
    const before = changes.length

    yield* Scope.close(scope, Exit.void)
    expect(yield* mcp.tools()).toEqual([])
    yield* waitUntil(() => changes.length > before)
    yield* registered("tui_open_terminal", false)
    expect(yield* mcp.callTool({ server: "tui", name: "open_terminal" }).pipe(Effect.flip)).toBeInstanceOf(
      Mcp.NotFoundError,
    )
  }),
)

it.live("fails an attach whose initial tool list fails and closes its transport", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const first = yield* clientServer("first", ["open_terminal"])
    const second = yield* clientServer("second", ["broken"])
    const failing = failingList(second.client)
    failing.state.fail = true
    let closed = false
    const close = failing.transport.close
    failing.transport.close = () => {
      closed = true
      return close()
    }

    yield* mcp.attach("tui", first.client)
    const error = yield* mcp.attach("tui", failing.transport).pipe(Effect.flip)
    expect(error.message).toContain("list failed")
    expect(closed).toBe(true)
    expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["open_terminal"])
  }),
)

it.live("routes an unknown tool on an attached-only name to the client", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const client = yield* clientServer("tui", ["open_terminal"])

    yield* mcp.attach("tui", client.client)
    expect(yield* mcp.callTool({ server: "tui", name: "missing" }).pipe(Effect.flip)).toBeInstanceOf(Mcp.ToolCallError)
  }),
)

it.live("removes an attached entry when the client closes the connection", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const changes = yield* toolsChanged
    const client = yield* clientServer("tui", ["open_terminal"])

    yield* mcp.attach("tui", client.client)
    yield* registered("tui_open_terminal")
    const before = changes.length

    yield* Effect.promise(() => client.server.close())
    yield* waitUntil(() => changes.length > before)
    expect(yield* mcp.tools()).toEqual([])
    yield* registered("tui_open_terminal", false)
  }),
)

it.live("stacks a second attach under the same name and keeps the first connected", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const first = yield* clientServer("first", ["old_tool", "shared"])
    const second = yield* clientServer("second", ["shared"])

    yield* mcp.attach("tui", first.client)
    yield* registered("tui_old_tool")
    yield* mcp.attach("tui", second.client)
    expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["shared"])
    yield* registered("tui_old_tool", false)

    const result = yield* call("tui.shared")
    expect(result.output?.output).toBe("second:shared")
    expect(first.sessions).toEqual([])
    expect(first.server.isConnected()).toBe(true)
  }),
)

it.live("falls back to the previous connection when the top one closes", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const changes = yield* toolsChanged
    const first = yield* clientServer("first", ["shared"])
    const second = yield* clientServer("second", ["shared"])

    yield* mcp.attach("tui", first.client)
    yield* mcp.attach("tui", second.client)
    // Changes on an idle connection stay hidden until it takes over.
    first.server.registerTool("added", { description: "first added" }, () => ({
      content: [{ type: "text", text: "first:added" }],
    }))
    yield* registered("tui_shared")
    expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["shared"])
    const before = changes.length

    yield* Effect.promise(() => second.server.close())
    yield* waitUntil(() => changes.length > before)
    expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["added", "shared"])
    yield* registered("tui_added")
    expect((yield* call("tui.shared")).output?.output).toBe("first:shared")
    expect((yield* call("tui.added")).output?.output).toBe("first:added")
  }),
)

it.live("falls back to a connection with the same tools without publishing a change", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const changes = yield* toolsChanged
    // Same label, so both list identical tools; the recorded sessions tell them apart.
    const first = yield* clientServer("same", ["shared"])
    const second = yield* clientServer("same", ["shared"])
    const marker = yield* clientServer("marker", ["done"])
    const scope = yield* Scope.make()

    yield* mcp.attach("tui", first.client)
    yield* mcp.attach("tui", second.client).pipe(Scope.provide(scope))
    yield* waitUntil(() => changes.length === 2)
    yield* registered("tui_shared")

    yield* Scope.close(scope, Exit.void)
    yield* call("tui.shared", Session.ID.make("ses_fallback"))
    expect(first.sessions).toEqual(["ses_fallback"])
    expect(second.sessions).toEqual([])
    // Events arrive in order, so once the marker's attach shows up any fallback event would have too.
    yield* mcp.attach("marker", marker.client)
    yield* waitUntil(() => changes.includes("marker"))
    expect(changes).toEqual(["tui", "tui", "marker"])
  }),
)

it.live("keeps the stored tools when the fallback re-list fails", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const changes = yield* toolsChanged
    const first = yield* clientServer("first", ["kept"])
    const second = yield* clientServer("second", ["newer"])
    const failing = failingList(first.client)
    const scope = yield* Scope.make()

    yield* mcp.attach("tui", failing.transport)
    yield* mcp.attach("tui", second.client).pipe(Scope.provide(scope))
    first.server.registerTool("hidden", { description: "first hidden" }, () => ({
      content: [{ type: "text", text: "first:hidden" }],
    }))
    failing.state.fail = true
    yield* waitUntil(() => changes.length === 2)

    yield* Scope.close(scope, Exit.void)
    expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["kept"])
    yield* waitUntil(() => changes.length === 3)
    yield* registered("tui_kept")
    expect((yield* call("tui.kept")).output?.output).toBe("first:kept")
  }),
)

it.live("refreshes the top connection's tools when it reports a change", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const changes = yield* toolsChanged
    const first = yield* clientServer("first", ["below"])
    const second = yield* clientServer("second", ["top"])

    yield* mcp.attach("tui", first.client)
    yield* mcp.attach("tui", second.client)
    yield* waitUntil(() => changes.length === 2)

    second.server.registerTool("added", { description: "second added" }, () => ({
      content: [{ type: "text", text: "second:added" }],
    }))
    yield* waitUntil(() => changes.length === 3)
    expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["added", "top"])
    yield* registered("tui_added")
    expect((yield* call("tui.added")).output?.output).toBe("second:added")
  }),
)

it.live("closing a connection below the top changes nothing visible", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const changes = yield* toolsChanged
    const first = yield* clientServer("first", ["old_tool"])
    const second = yield* clientServer("second", ["shared"])
    const scope = yield* Scope.make()

    yield* mcp.attach("tui", first.client).pipe(Scope.provide(scope))
    yield* mcp.attach("tui", second.client)
    yield* waitUntil(() => changes.length === 2)
    yield* registered("tui_shared")

    yield* Scope.close(scope, Exit.void)
    yield* waitUntil(() => !first.server.isConnected())
    expect(changes).toHaveLength(2)
    expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["shared"])
    expect((yield* call("tui.shared")).output?.output).toBe("second:shared")
  }),
)

it.live("removes the entry once every stacked connection closes", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const first = yield* clientServer("first", ["shared"])
    const second = yield* clientServer("second", ["shared"])

    yield* mcp.attach("tui", first.client)
    yield* mcp.attach("tui", second.client)
    yield* registered("tui_shared")

    yield* Effect.promise(() => second.server.close())
    yield* Effect.promise(() => first.server.close())
    yield* waitUntil(() => !first.server.isConnected() && !second.server.isConnected())
    yield* registered("tui_shared", false)
    expect(yield* mcp.tools()).toEqual([])
    expect(yield* mcp.callTool({ server: "tui", name: "shared" }).pipe(Effect.flip)).toBeInstanceOf(Mcp.NotFoundError)
  }),
)

it.live("hides attached entries from server status and keeps them across config reconciles", () =>
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const client = yield* clientServer("tui", ["open_terminal"])

    yield* mcp.attach("tui", client.client)
    expect(yield* mcp.servers()).toEqual([])

    // A configured server sharing the client's name neither shows the client nor captures its tools.
    yield* mcp.add("tui", new ConfigMCP.Local({ type: "local", command: ["unused"], disabled: true }))
    yield* mcp.add("other", new ConfigMCP.Local({ type: "local", command: ["unused"], disabled: true }))
    expect((yield* mcp.servers()).map((server) => [server.name, server.status.status])).toEqual([
      ["other", "disabled"],
      ["tui", "disabled"],
    ])
    yield* mcp.remove("tui")
    yield* mcp.reload()
    expect((yield* mcp.servers()).map((server) => server.name)).toEqual(["other"])

    expect((yield* mcp.tools()).map((tool) => [tool.server, tool.name])).toEqual([["tui", "open_terminal"]])
    const result = yield* mcp.callTool({ server: "tui", name: "open_terminal" })
    expect(result.content).toEqual([{ type: "text", text: "tui:open_terminal" }])
  }),
)
