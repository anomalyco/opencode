import { describe, expect } from "bun:test"
import { InMemoryTransport, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client"
import { McpEvent } from "@opencode/schema/mcp-event"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Mcp } from "@opencode/core/mcp/index"
import { Effect, Exit, Layer, Scope } from "effect"
import { testEffect } from "../lib/effect"
import { make } from "./fixture/server"
import { until, world, type Place } from "./harness"

const it = testEffect(Layer.empty)

// A client-hosted fixture listing `tools` after its own, attached to `place` in `scope`.
const attach = (place: Place, tools: string[], scope?: Scope.Scope) =>
  Effect.gen(function* () {
    const [client, transport] = InMemoryTransport.createLinkedPair()
    const state = { added: tools }
    const server = make({}, state, () => void server.sendToolListChanged())
    yield* Effect.promise(() => server.connect(transport))
    const attached = place.mcp.attach("client", client)
    yield* scope ? attached.pipe(Scope.provide(scope)) : attached
    return { server, state, disconnect: Effect.promise(() => server.close()) }
  })

const names = (place: Place) =>
  place.mcp
    .tools()
    .pipe(Effect.map((tools) => tools.filter((tool) => tool.server === "client").map((tool) => tool.name)))
const changes = (place: Place) =>
  place.events.filter(
    (event) => event.type === McpEvent.ToolsChanged.type && (event.data as { server: string }).server === "client",
  ).length

describe("MCP attached clients", () => {
  it.live("stack under one name: the newest serves, and the one below takes over when it goes", () =>
    Effect.gen(function* () {
      const place = yield* (yield* world).open({})
      const first = yield* attach(place, ["first"])
      const second = yield* attach(place, ["second"])
      expect(yield* names(place)).toContain("second")
      expect(yield* names(place)).not.toContain("first")
      yield* until(
        "both attaches announced",
        Effect.sync(() => changes(place)),
        (count) => count === 2,
      )

      // Changes below the top stay hidden until it takes over, which lists its tools again.
      first.state.added.push("later")
      yield* second.disconnect
      yield* until("the fallback", names(place), (list) => list.includes("later"))
      expect((yield* place.mcp.callTool({ server: "client", name: "later" })).content).toEqual([
        { type: "text", text: "later" },
      ])

      // The top relists when it announces a change.
      yield* place.mcp.callTool({ server: "client", name: "change" })
      yield* until("the change", names(place), (list) => list.includes("added_3"))

      yield* first.disconnect
      yield* until("the last to go", names(place), (list) => list.length === 0)
      expect(yield* place.mcp.callTool({ server: "client", name: "echo" }).pipe(Effect.flip)).toBeInstanceOf(
        Mcp.NotFoundError,
      )
    }),
  )

  it.live("change nothing visible when the one below the top goes, or when one with the same tools takes over", () =>
    Effect.gen(function* () {
      const place = yield* (yield* world).open({})
      const below = yield* Scope.make()
      const top = yield* Scope.make()
      yield* attach(place, ["same"], below)
      yield* attach(place, ["same"])
      yield* attach(place, ["same"], top)
      yield* until(
        "the attaches announced",
        Effect.sync(() => changes(place)),
        (count) => count === 3,
      )
      yield* Scope.close(below, Exit.void)
      yield* Scope.close(top, Exit.void)
      // Events arrive in order, so once a later attach shows, any change the closes caused would have too.
      yield* attach(place, ["marker"])
      yield* until(
        "the marker",
        Effect.sync(() => changes(place)),
        (count) => count >= 4,
      )
      expect(changes(place)).toBe(4)
    }),
  )

  it.live("fail an attach whose first tool list fails, and close its transport", () =>
    Effect.gen(function* () {
      const place = yield* (yield* world).open({})
      const [client, transport] = InMemoryTransport.createLinkedPair()
      const server = make({}, { added: [] }, () => {})
      yield* Effect.promise(() => server.connect(transport))
      const state = { closed: false }
      // Answers tools/list with an error, as a client that broke mid-handshake would.
      const failing: Transport = {
        start: () => client.start(),
        close: () => ((state.closed = true), client.close()),
        send: (message: JSONRPCMessage, options) =>
          "method" in message && message.method === "tools/list" && "id" in message
            ? Promise.resolve(
                queueMicrotask(() =>
                  failing.onmessage?.({
                    jsonrpc: "2.0",
                    id: message.id,
                    error: { code: -32603, message: "list failed" },
                  }),
                ),
              )
            : client.send(message, options),
      }
      client.onmessage = (message, extra) => failing.onmessage?.(message, extra)
      client.onclose = () => failing.onclose?.()
      expect((yield* place.mcp.attach("client", failing).pipe(Effect.flip)).message).toContain("list failed")
      expect(state.closed).toBe(true)
      expect(yield* names(place)).toEqual([])
    }),
  )

  it.live("stay out of server status, and own their tools over a configured server of the same name", () =>
    Effect.gen(function* () {
      const place = yield* (yield* world).open({})
      yield* attach(place, ["mine"])
      expect(yield* place.mcp.servers()).toEqual([])
      // An unknown tool still goes to the client that holds the name, and fails there.
      expect(yield* place.mcp.callTool({ server: "client", name: "missing" }).pipe(Effect.flip)).toBeInstanceOf(
        Mcp.ToolCallError,
      )
      yield* place.mcp.add("client", new ConfigMCP.Local({ type: "local", command: ["unused"], disabled: true }))
      yield* place.mcp.reload()
      expect((yield* place.mcp.servers()).map((server) => [server.name, server.status.status])).toEqual([
        ["client", "disabled"],
      ])
      expect((yield* place.mcp.callTool({ server: "client", name: "mine" })).content).toEqual([
        { type: "text", text: "mine" },
      ])
      yield* place.mcp.remove("client")
      expect(yield* names(place)).toContain("mine")
    }),
  )
})
