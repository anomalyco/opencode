import { describe, expect } from "bun:test"
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/client"
import { McpClient } from "@opencode/core/mcp/client"
import { Effect } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { testEffect } from "./lib/effect"

const it = testEffect(hostEnvironmentLayer)

/**
 * A 2026-07-28 MCP server speaking raw JSON-RPC that offers tool list changes and records the listen streams opened
 * on it, so a test can end one the way a server shutdown, proxy idle timeout or serverless response limit would.
 */
const catalogServer = Effect.fnUntraced(function* () {
  const [transport, server] = InMemoryTransport.createLinkedPair()
  const state = {
    tools: [] as Array<{ name: string; inputSchema: Record<string, unknown> }>,
    listens: [] as Array<{ id: string | number; params: unknown }>,
    refuse: false,
    hangUp: false,
  }
  const capabilities = { tools: { listChanged: true } }
  const reply = (id: string | number, result: Record<string, unknown>) =>
    server.send({ jsonrpc: "2.0", id, result: { resultType: "complete", ...result } })
  server.onmessage = (message: JSONRPCMessage) => {
    if (!("method" in message)) return
    // Every 2026-07-28 request carries the protocol envelope in `_meta`.
    const { _meta: meta, ...params } = message.params ?? {}
    if (!("id" in message)) return
    if (message.method === "server/discover")
      void reply(message.id, {
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "catalog", version: "1.0.0" } },
        supportedVersions: ["2026-07-28"],
        capabilities,
      })
    if (message.method === "initialize")
      void reply(message.id, {
        protocolVersion: params.protocolVersion,
        capabilities,
        serverInfo: { name: "catalog", version: "1.0.0" },
      })
    if (message.method === "tools/list")
      // The result, like every 2026-07-28 listing, carries a cache envelope.
      void reply(message.id, { tools: state.tools, ttlMs: 0, cacheScope: "private" })
    if (message.method === "subscriptions/listen") {
      state.listens.push({ id: message.id, params })
      // A refusal is a ProtocolError, which the follow loop must not retry.
      if (state.refuse) {
        void server.send({ jsonrpc: "2.0", id: message.id, error: { code: -32600, message: "refused" } })
        return
      }
      void server.send({
        jsonrpc: "2.0",
        method: "notifications/subscriptions/acknowledged",
        params: { notifications: params.notifications, _meta: { "io.modelcontextprotocol/subscriptionId": message.id } },
      })
      // A server that acknowledges and then ends the stream at once, as a proxy closing each response would.
      if (state.hangUp) void reply(message.id, {})
    }
  }
  yield* Effect.promise(() => server.start())
  return {
    state,
    transport,
    // The spec's graceful-close signal for a subscription is the empty listen result, which is what a server shutdown
    // sends. A dropped stream settles the same promise with "remote".
    end: (id: string | number) => Effect.promise(() => reply(id, {})),
    change: (id: string | number) =>
      Effect.promise(() =>
        server.send({
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
          params: { _meta: { "io.modelcontextprotocol/subscriptionId": id } },
        }),
      ),
    add: (name: string) => Effect.sync(() => state.tools.push({ name, inputSchema: { type: "object" } })),
  }
})

// Waits for an observed count rather than an exact one: a refresh and a notification can both land between two polls.
const until = (check: () => boolean) =>
  Effect.promise(async () => {
    const deadline = Date.now() + 10_000
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out")
      await Bun.sleep(1)
    }
  })

describe("MCP list changes", () => {
  it.live("reopens the list change stream a server ended, so the catalog keeps updating", () =>
    Effect.gen(function* () {
      const server = yield* catalogServer()
      const connection = yield* McpClient.connect({
        server: "catalog",
        config: { type: "attached", transport: server.transport, protocol: "2026-07-28" },
        directory: import.meta.dir,
      })
      const changes = { tools: 0 }
      connection.onToolsChanged(() => {
        changes.tools += 1
      })
      expect(yield* connection.tools()).toEqual([])

      // The SDK opens a list change stream of its own; opencode takes the stream over so it can reopen it.
      yield* until(() => server.state.listens.length === 2)
      const filter = server.state.listens[0].params
      expect(server.state.listens[1].params).toEqual(filter)
      yield* until(() => changes.tools >= 1)
      const opened = changes.tools

      // A stream the server ended must come back with the filter it honored, instead of leaving the server
      // "connected" with a frozen catalog.
      yield* server.end(server.state.listens[1].id)
      yield* until(() => server.state.listens.length === 3)
      expect(server.state.listens[2].params).toEqual(filter)

      // Reopening refreshes once, so a change announced while the stream was down is not lost.
      yield* until(() => changes.tools > opened)
      const caughtUp = changes.tools

      // And the reopened stream delivers changes again.
      yield* server.add("added")
      yield* server.change(server.state.listens[2].id)
      yield* until(() => changes.tools > caughtUp)
      expect((yield* connection.tools()).map((tool) => tool.name)).toEqual(["added"])
    }),
  )

  it.live("stops following when the server refuses the reopened stream", () =>
    Effect.gen(function* () {
      const server = yield* catalogServer()
      const connection = yield* McpClient.connect({
        server: "catalog",
        config: { type: "attached", transport: server.transport, protocol: "2026-07-28" },
        directory: import.meta.dir,
      })
      yield* connection.tools()
      yield* until(() => server.state.listens.length === 2)

      // The reopen is refused, as when access was revoked or the server dropped the capability. Retrying a refusal
      // would hammer the server for the life of the connection, so the follow loop ends after the first one.
      server.state.refuse = true
      yield* server.end(server.state.listens[1].id)
      yield* until(() => server.state.listens.length === 3)
      yield* Effect.sleep("3 seconds")
      expect(server.state.listens.length).toBe(3)
    }),
  )

  it.live("waits out the backoff when a server ends every stream at once", () =>
    Effect.gen(function* () {
      const server = yield* catalogServer()
      server.state.hangUp = true
      const connection = yield* McpClient.connect({
        server: "catalog",
        config: { type: "attached", transport: server.transport, protocol: "2026-07-28" },
        directory: import.meta.dir,
      })
      yield* connection.tools()
      // Every open is acknowledged and then ended by the server. Without the schedule covering the close as well as
      // a refused open, this reopens as fast as the transport allows.
      yield* Effect.sleep("2 seconds")
      expect(server.state.listens.length).toBeLessThan(10)
    }),
  )
})
