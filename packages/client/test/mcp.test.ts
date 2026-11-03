import { afterEach, describe, expect, jest, test } from "bun:test"
import { Client, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client"
import type { ServerWebSocket } from "bun"
import { connectClientMcp } from "../src/mcp"

type Peer = {
  readonly request: Request
  readonly socket: ServerWebSocket<{ id: number; request: Request }>
  readonly client: Client
  readonly closed: Promise<void>
}

const servers: Array<{ stop(force: boolean): Promise<void> }> = []
afterEach(async () => {
  jest.useRealTimers()
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

describe("connectClientMcp", () => {
  test("serves registered tools to the opencode server", async () => {
    const server = serve()
    const connection = connectClientMcp({
      url: server.url + "?ticket=t1",
      name: "tui",
      directory: "/repo",
      headers: { authorization: "Basic secret" },
      tools: [
        {
          name: "whoami",
          description: "Return the calling session",
          handler: (_args, ctx) => ({ content: [{ type: "text", text: ctx.sessionID ?? "none" }] }),
        },
        {
          name: "echo",
          inputSchema: { properties: { text: { type: "string" } }, required: ["text"] },
          handler: (args) => ({ content: [{ type: "text", text: String(args.text) }] }),
        },
        {
          name: "fail",
          handler: () => {
            throw new Error("boom")
          },
        },
      ],
    })
    const peer = await server.next()

    const url = new URL(peer.request.url)
    expect(url.pathname).toBe("/api/experimental/client-mcp")
    expect(url.searchParams.get("name")).toBe("tui")
    expect(url.searchParams.get("ticket")).toBe("t1")
    expect(url.searchParams.get("location[directory]")).toBe("/repo")
    expect(peer.request.headers.get("authorization")).toBe("Basic secret")

    await peer.client.ping()
    expect((await peer.client.listTools()).tools).toEqual([
      { name: "whoami", description: "Return the calling session", inputSchema: { type: "object" } },
      {
        name: "echo",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
      { name: "fail", inputSchema: { type: "object" } },
    ])
    expect(
      await peer.client.callTool({ name: "whoami", arguments: {}, _meta: { "ai.opencode/sessionID": "ses_1" } }),
    ).toMatchObject({ content: [{ type: "text", text: "ses_1" }] })
    expect(await peer.client.callTool({ name: "whoami", arguments: {} })).toMatchObject({
      content: [{ type: "text", text: "none" }],
    })

    expect(await peer.client.callTool({ name: "echo", arguments: { text: "hi" } })).toMatchObject({
      content: [{ type: "text", text: "hi" }],
    })
    expect(await peer.client.callTool({ name: "fail", arguments: {} })).toMatchObject({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    })
    await expect(peer.client.callTool({ name: "missing", arguments: {} })).rejects.toThrow("Unknown tool: missing")

    await connection.close()
    await peer.closed
  })

  test("reconnects after the server drops the socket", async () => {
    const server = serve()
    const connection = connectClientMcp({
      url: server.url,
      name: "tui",
      tools: [{ name: "ping", handler: () => ({ content: [{ type: "text", text: "pong" }] }) }],
    })
    const first = await server.next()
    expect((await first.client.listTools()).tools).toHaveLength(1)

    first.socket.close(1011, "internal")
    const second = await server.next()
    expect(await second.client.callTool({ name: "ping", arguments: {} })).toMatchObject({
      content: [{ type: "text", text: "pong" }],
    })

    await connection.close()
  })

  test("close cancels a pending reconnect", async () => {
    const server = serve()
    const socket = trackedSocket()
    const connection = connectClientMcp({ url: server.url, name: "tui", tools: [], WebSocket: socket.WebSocket })
    const peer = await server.next()

    jest.useFakeTimers()
    peer.socket.close(1011, "internal")
    await socket.closed(1)
    await connection.close()
    jest.advanceTimersByTime(10_000)
    expect(socket.opened()).toBe(1)
  })

  test("keeps backing off while the opencode server never initializes", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return
        return new Response("upgrade required", { status: 426 })
      },
      websocket: {
        open(socket) {
          socket.send("not json")
          socket.close(1011, "internal")
        },
        message() {},
      },
    })
    servers.push(server)
    const socket = trackedSocket()
    jest.useFakeTimers()
    const connection = connectClientMcp({
      url: server.url.href,
      name: "tui",
      tools: [],
      WebSocket: socket.WebSocket,
    })

    await socket.closed(1)
    jest.advanceTimersByTime(500)
    expect(socket.opened()).toBe(2)
    await socket.closed(2)
    jest.advanceTimersByTime(999)
    expect(socket.opened()).toBe(2)
    jest.advanceTimersByTime(1)
    expect(socket.opened()).toBe(3)

    await connection.close()
  })
})

/** Counts sockets synchronously at construction, so fake-timer reconnects are observable without real waits. */
function trackedSocket() {
  const state = { opened: 0, closed: 0, waiting: [] as Array<{ count: number; resolve: () => void }> }
  class Tracked extends WebSocket {
    constructor(url: string | URL, init?: string | string[]) {
      super(url, init)
      state.opened++
      this.addEventListener("close", () => {
        state.closed++
        state.waiting = state.waiting.filter((waiter) => {
          if (state.closed < waiter.count) return true
          // Let connectClientMcp's own close listener run before the test continues.
          setImmediate(waiter.resolve)
          return false
        })
      })
    }
  }
  return {
    WebSocket: Tracked,
    opened: () => state.opened,
    closed: (count: number) =>
      new Promise<void>((resolve) => {
        if (state.closed >= count) return resolve()
        state.waiting.push({ count, resolve })
      }),
  }
}

function serve() {
  const waiting: Array<(peer: Peer) => void> = []
  const ready: Peer[] = []
  const transports = new Map<number, ReturnType<typeof socketTransport>>()
  const state = { connections: 0 }
  const server = Bun.serve<{ id: number; request: Request }>({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request, { data: { id: ++state.connections, request } })) return
      return new Response("upgrade required", { status: 426 })
    },
    websocket: {
      open(socket) {
        const transport = socketTransport(socket)
        transports.set(socket.data.id, transport)
        const client = new Client({ name: "opencode", version: "1.0.0" })
        const closed = new Promise<void>((resolve) => {
          client.onclose = resolve
        })
        void client.connect(transport).then(() => {
          const peer = { request: socket.data.request, socket, client, closed }
          const resolve = waiting.shift()
          if (resolve) return resolve(peer)
          ready.push(peer)
        })
      },
      // Deliver outside the uWS callback: on Bun 1.4.4, replying from the SDK's microtasks inside it can make the
      // server reject the client's next frame ("Received new message inside a fragmented message").
      message(socket, message) {
        const text = String(message)
        setImmediate(() => transports.get(socket.data.id)?.deliver(text))
      },
      close(socket) {
        setImmediate(() => transports.get(socket.data.id)?.ended())
      },
    },
  })
  const result = {
    url: server.url.href,
    next: () =>
      new Promise<Peer>((resolve) => {
        const peer = ready.shift()
        if (peer) return resolve(peer)
        waiting.push(resolve)
      }),
    stop: (force: boolean) => server.stop(force),
  }
  servers.push(result)
  return result
}

function socketTransport(socket: ServerWebSocket<{ id: number; request: Request }>) {
  const state = { closed: false }
  const transport: Transport & { deliver(text: string): void; ended(): void } = {
    async start() {},
    async send(message: JSONRPCMessage) {
      if (state.closed) throw new Error("Not connected")
      socket.send(JSON.stringify(message))
    },
    async close() {
      socket.close(1000)
      transport.ended()
    },
    deliver(text) {
      transport.onmessage?.(JSON.parse(text))
    },
    ended() {
      if (state.closed) return
      state.closed = true
      transport.onclose?.()
    },
  }
  return transport
}
