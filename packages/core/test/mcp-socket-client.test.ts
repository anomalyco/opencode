import { describe, expect, test } from "bun:test"
import { Client, type JSONRPCMessage } from "@modelcontextprotocol/client"
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server"
import { McpSocketClient } from "@opencode/core/mcp/socket-client"

function fakeSocket() {
  const socket = {
    sent: [] as string[],
    closed: [] as Array<number | undefined>,
    send: (text: string) => {
      socket.sent.push(text)
    },
    close: (code?: number) => {
      socket.closed.push(code)
    },
  }
  return socket
}

function observe(transport: McpSocketClient.SocketTransport) {
  const seen = { messages: [] as JSONRPCMessage[], errors: [] as Error[], closes: 0 }
  transport.onmessage = (message) => seen.messages.push(message)
  transport.onerror = (error) => seen.errors.push(error)
  transport.onclose = () => seen.closes++
  return seen
}

const ping: JSONRPCMessage = { jsonrpc: "2.0", id: 1, method: "ping" }

describe("McpSocketClient", () => {
  test("buffers frames that arrive before start", async () => {
    const transport = McpSocketClient.make(fakeSocket())
    const seen = observe(transport)
    transport.deliver(JSON.stringify(ping))
    transport.deliver(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))
    expect(seen.messages).toEqual([])
    await transport.start()
    expect(seen.messages).toEqual([ping, { jsonrpc: "2.0", method: "notifications/initialized" }])
  })

  test("sends one JSON frame per message and delivers inbound frames", async () => {
    const socket = fakeSocket()
    const transport = McpSocketClient.make(socket)
    const seen = observe(transport)
    await transport.start()
    await transport.send(ping)
    expect(socket.sent).toEqual([JSON.stringify(ping)])
    transport.deliver(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }))
    expect(seen.messages).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }])
  })

  test("reports invalid frames and stays open", async () => {
    const socket = fakeSocket()
    const transport = McpSocketClient.make(socket)
    const seen = observe(transport)
    await transport.start()
    transport.deliver("not json")
    transport.deliver(JSON.stringify({ hello: "world" }))
    expect(seen.errors.length).toBe(2)
    expect(seen.closes).toBe(0)
    expect(socket.closed).toEqual([])
    transport.deliver(JSON.stringify(ping))
    expect(seen.messages).toEqual([ping])
    await transport.send(ping)
    expect(socket.sent.length).toBe(1)
  })

  test("fires onclose once when the socket ends", async () => {
    const socket = fakeSocket()
    const transport = McpSocketClient.make(socket)
    const seen = observe(transport)
    await transport.start()
    transport.ended()
    transport.ended()
    await transport.close()
    expect(seen.closes).toBe(1)
    expect(socket.closed).toEqual([])
    transport.deliver(JSON.stringify(ping))
    expect(seen.messages).toEqual([])
  })

  test("rejects send after close", async () => {
    const transport = McpSocketClient.make(fakeSocket())
    observe(transport)
    await transport.start()
    transport.ended()
    await expect(transport.send(ping)).rejects.toThrow("Not connected")
  })

  test("close() closes the socket with 1000 and fires onclose once", async () => {
    const socket = fakeSocket()
    const transport = McpSocketClient.make(socket)
    const seen = observe(transport)
    await transport.start()
    await transport.close()
    await transport.close()
    transport.ended()
    expect(socket.closed).toEqual([1000])
    expect(seen.closes).toBe(1)
    await expect(transport.send(ping)).rejects.toThrow("Not connected")
  })

  test("fires onclose when the socket ends before start, then rejects start", async () => {
    const transport = McpSocketClient.make(fakeSocket())
    const seen = observe(transport)
    transport.deliver(JSON.stringify(ping))
    transport.ended()
    expect(seen.closes).toBe(1)
    await expect(transport.start()).rejects.toThrow("Not connected")
    expect(seen.messages).toEqual([])
  })

  test("close() before start drops buffered frames and rejects start", async () => {
    const socket = fakeSocket()
    const transport = McpSocketClient.make(socket)
    const seen = observe(transport)
    transport.deliver(JSON.stringify(ping))
    await transport.close()
    expect(socket.closed).toEqual([1000])
    expect(seen.closes).toBe(1)
    await expect(transport.start()).rejects.toThrow("Not connected")
    expect(seen.messages).toEqual([])
  })

  test("close() fires onclose and rejects when the socket close throws", async () => {
    const transport = McpSocketClient.make({
      send: () => {},
      close: () => {
        throw new Error("boom")
      },
    })
    const seen = observe(transport)
    await transport.start()
    await expect(transport.close()).rejects.toThrow("boom")
    expect(seen.closes).toBe(1)
  })

  test("keeps FIFO order for frames delivered while flushing the buffer", async () => {
    const transport = McpSocketClient.make(fakeSocket())
    const seen = observe(transport)
    const third: JSONRPCMessage = { jsonrpc: "2.0", id: 3, method: "ping" }
    transport.onmessage = (message) => {
      seen.messages.push(message)
      if (seen.messages.length === 1) transport.deliver(JSON.stringify(third))
    }
    transport.deliver(JSON.stringify(ping))
    transport.deliver(JSON.stringify({ ...ping, id: 2 }))
    await transport.start()
    expect(seen.messages).toEqual([ping, { ...ping, id: 2 }, third])
  })

  test("send resolves to undefined", async () => {
    const transport = McpSocketClient.make({ send: () => true, close: () => {} })
    observe(transport)
    await transport.start()
    expect(await transport.send(ping)).toBeUndefined()
  })

  test("rejects a second start", async () => {
    const transport = McpSocketClient.make(fakeSocket())
    observe(transport)
    await transport.start()
    await expect(transport.start()).rejects.toThrow("already started")
  })

  test("rejects send before start", async () => {
    const socket = fakeSocket()
    const transport = McpSocketClient.make(socket)
    observe(transport)
    await expect(transport.send(ping)).rejects.toThrow("Not connected")
    expect(socket.sent).toEqual([])
  })

  test("stops flushing buffered frames once closed", async () => {
    const transport = McpSocketClient.make(fakeSocket())
    const seen = observe(transport)
    transport.onmessage = (message) => {
      seen.messages.push(message)
      transport.ended()
    }
    transport.deliver(JSON.stringify(ping))
    transport.deliver(JSON.stringify(ping))
    await transport.start()
    expect(seen.messages).toEqual([ping])
    expect(seen.closes).toBe(1)
  })

  test("carries an MCP session between the SDK client and server", async () => {
    // Two transports wired back to back stand in for the two ends of one WebSocket.
    const ends: { client?: McpSocketClient.SocketTransport; server?: McpSocketClient.SocketTransport } = {}
    const link = (peer: () => McpSocketClient.SocketTransport | undefined) => ({
      send: (text: string) => queueMicrotask(() => peer()?.deliver(text)),
      close: () => queueMicrotask(() => peer()?.ended()),
    })
    ends.client = McpSocketClient.make(link(() => ends.server))
    ends.server = McpSocketClient.make(link(() => ends.client))

    const server = new McpServer({ name: "app", version: "1.0.0" })
    server.registerTool(
      "echo",
      {
        description: "Echo text",
        inputSchema: fromJsonSchema<{ text: string }>({
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        }),
      },
      async (input) => ({ content: [{ type: "text", text: `echo: ${input.text}` }] }),
    )
    const client = new Client({ name: "opencode", version: "1.0.0" })
    const closed = Promise.withResolvers<void>()
    server.server.onclose = () => closed.resolve()
    await Promise.all([server.connect(ends.server), client.connect(ends.client)])

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual(["echo"])
    expect(await client.callTool({ name: "echo", arguments: { text: "hi" } })).toMatchObject({
      content: [{ type: "text", text: "echo: hi" }],
    })

    await client.close()
    await closed.promise
  })
})
