import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import type { IncomingMessage } from "node:http"
import net, { type AddressInfo, type Socket } from "node:net"
import WebSocket, { WebSocketServer } from "ws"
import { OpenAIWebSocket } from "../../src/plugin/openai/ws"
import { OpenAIWebSocketPool, TITLE_HEADER } from "../../src/plugin/openai/ws-pool"

describe("plugin.openai.ws", () => {
  test("derives websocket URLs and sends auth plus protocol headers", async () => {
    let headers: IncomingMessage["headers"] | undefined
    await using server = await createWebSocketServer((_socket, request) => {
      headers = request.headers
    })

    const socket = await OpenAIWebSocket.connectResponsesWebSocket({
      url: server.wsUrl,
      headers: { authorization: "Bearer test", "content-length": "123" },
    })

    expect(OpenAIWebSocket.toWebSocketUrl("http://example.com/v1/responses")).toBe("ws://example.com/v1/responses")
    expect(OpenAIWebSocket.toWebSocketUrl("https://example.com/v1/responses")).toBe("wss://example.com/v1/responses")
    expect(headers?.authorization).toBe("Bearer test")
    expect(headers?.["openai-beta"]).toBe(OpenAIWebSocket.PROTOCOL_HEADER)
    expect(headers?.["content-length"]).toBeUndefined()
    socket.terminate()
  })

  test("enforces websocket connect timeout", async () => {
    await using server = await createHangingTcpServer()

    await expect(
      OpenAIWebSocket.connectResponsesWebSocket({
        url: server.wsUrl,
        headers: {},
        timeout: 20,
      }),
    ).rejects.toThrow("WebSocket connect timed out")
  })

  test("enforces websocket send idle timeout", async () => {
    const socket = new (class extends EventEmitter {
      send(_data: string, _callback: (error?: Error) => void) {}
    })() as unknown as WebSocket
    const invalid: string[] = []
    const response = OpenAIWebSocket.streamResponsesWebSocket({
      socket,
      body: { stream: true, input: "hi" },
      idleTimeout: 20,
      onConnectionInvalid: (error) => invalid.push(error.message),
    })

    await expect(response.text()).rejects.toThrow("idle timeout sending websocket request")
    expect(invalid).toEqual(["idle timeout sending websocket request"])
  })

  test("streams websocket events as SSE and handles response.done", async () => {
    let requestBody: unknown
    await using server = await createWebSocketServer((socket) => {
      socket.once("message", (data) => {
        requestBody = JSON.parse(data.toString())
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "hello" }))
        socket.send(JSON.stringify({ type: "response.done", response: { id: "resp_123" } }))
        socket.close(1000, "done")
      })
    })

    const socket = await OpenAIWebSocket.connectResponsesWebSocket({
      url: server.wsUrl,
      headers: { authorization: "Bearer test", "content-length": "123" },
    })
    const completed: Record<string, unknown>[] = []
    const response = OpenAIWebSocket.streamResponsesWebSocket({
      socket,
      body: { stream: true, background: true, input: "hi" },
      onComplete: (event) => completed.push(event),
    })

    expect(await response.text()).toBe(
      'data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"type":"response.done","response":{"id":"resp_123"}}\n\ndata: [DONE]\n\n',
    )
    expect(requestBody).toEqual({ type: "response.create", input: "hi" })
    expect(completed).toHaveLength(1)
    expect(completed[0]?.type).toBe("response.done")
  })

  test("errors the SSE stream when the server closes before a terminal event", async () => {
    const invalid: string[] = []
    await using server = await createWebSocketServer((socket) => {
      socket.once("message", () => {
        socket.close(1009, "payload too large")
      })
    })

    const socket = await OpenAIWebSocket.connectResponsesWebSocket({ url: server.wsUrl, headers: {} })
    const response = OpenAIWebSocket.streamResponsesWebSocket({
      socket,
      body: { stream: true, input: "hi" },
      onConnectionInvalid: (error) => invalid.push(error.message),
    })

    await expect(response.text()).rejects.toThrow(
      "WebSocket closed before response.completed (code 1009: message too big: payload too large)",
    )
    expect(invalid).toEqual([
      "WebSocket closed before response.completed (code 1009: message too big: payload too large)",
    ])
  })

  test("rejects unexpected binary websocket frames", async () => {
    const invalid: string[] = []
    await using server = await createWebSocketServer((socket) => {
      socket.once("message", () => {
        socket.send(Buffer.from("not json text"))
      })
    })

    const socket = await OpenAIWebSocket.connectResponsesWebSocket({ url: server.wsUrl, headers: {} })
    const response = OpenAIWebSocket.streamResponsesWebSocket({
      socket,
      body: { stream: true, input: "hi" },
      onConnectionInvalid: (error) => invalid.push(error.message),
    })

    await expect(response.text()).rejects.toThrow("Unexpected binary WebSocket frame")
    expect(invalid).toEqual(["Unexpected binary WebSocket frame"])
  })
})

describe("plugin.openai.ws-pool", () => {
  test("reuses one healthy websocket for sequential requests", async () => {
    let connections = 0
    let messages = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.on("message", () => {
        messages += 1
        socket.send(JSON.stringify({ type: "response.completed", response: { id: `resp_${messages}` } }))
      })
    })
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async () => new Response("http")),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest())
    expect(await first.text()).toContain("data: [DONE]")

    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())
    expect(await second.text()).toContain("data: [DONE]")
    expect(connections).toBe(1)
    expect(messages).toBe(2)
    fetch.close()
  })

  test("rotates a socket that exceeds max connection age", async () => {
    let connections = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.on("message", () => {
        socket.send(JSON.stringify({ type: "response.completed", response: { id: `resp_${connections}` } }))
      })
    })
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async () => new Response("http")),
      maxConnectionAge: 0,
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest())
    expect(await first.text()).toContain("data: [DONE]")

    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())
    expect(await second.text()).toContain("data: [DONE]")
    expect(connections).toBe(2)
    fetch.close()
  })

  test("falls back to HTTP when websocket setup fails and keeps the fallback sticky", async () => {
    const attempts: string[] = []
    await using server = await createRejectingWebSocketServer(() => attempts.push("websocket"))
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
      connectTimeout: 100,
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest({ [TITLE_HEADER]: "false" }))
    const second = await fetch("https://api.openai.com/v1/responses", streamRequest({ [TITLE_HEADER]: "false" }))

    expect(await first.text()).toBe("http")
    expect(await second.text()).toBe("http")
    expect(attempts).toEqual(["websocket"])
    expect(httpRequests).toHaveLength(2)
    expect(httpRequests[0]?.get(TITLE_HEADER)).toBeNull()
    expect(httpRequests[1]?.get(TITLE_HEADER)).toBeNull()
    fetch.close()
  })

  test("invalidates but does not reuse a socket after terminal failure frames", async () => {
    let connections = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.once("message", () => {
        socket.send(JSON.stringify({ type: connections === 1 ? "response.failed" : "response.completed" }))
      })
    })
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest())
    expect(await first.text()).toContain('data: {"type":"response.failed"}')

    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())
    expect(await second.text()).toContain('data: {"type":"response.completed"}')
    expect(connections).toBe(2)
    expect(httpRequests).toHaveLength(0)
    fetch.close()
  })

  test("reconnects and replays after websocket connection limit errors", async () => {
    let connections = 0
    let messages = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.once("message", () => {
        messages += 1
        if (connections === 1) {
          socket.send(
            JSON.stringify({
              type: "error",
              status: 400,
              error: {
                type: "invalid_request_error",
                code: "websocket_connection_limit_reached",
                message: "Responses websocket connection limit reached",
              },
            }),
          )
          return
        }
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_retry" } }))
      })
    })
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const response = await fetch("https://api.openai.com/v1/responses", streamRequest())
    const text = await response.text()

    expect(text).not.toContain("websocket_connection_limit_reached")
    expect(text).toContain('data: {"type":"response.completed","response":{"id":"resp_retry"}}')
    expect(text).toContain("data: [DONE]")
    expect(connections).toBe(2)
    expect(messages).toBe(2)
    expect(httpRequests).toHaveLength(0)
    fetch.close()
  })

  test("falls back to HTTP after websocket connection limit retries are exhausted", async () => {
    let connections = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "error",
            status: 400,
            error: {
              type: "invalid_request_error",
              code: "websocket_connection_limit_reached",
              message: "Responses websocket connection limit reached",
            },
          }),
        )
      })
    })
    let httpRequests = 0
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      connectionLimitRetries: 2,
      httpFetch: mockFetch(async () => {
        httpRequests += 1
        return new Response("http")
      }),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest())
    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())

    expect(await first.text()).toBe("http")
    expect(await second.text()).toBe("http")
    expect(connections).toBe(3)
    expect(httpRequests).toBe(2)
    fetch.close()
  })

  test("replays over HTTP when websocket idles before its first event", async () => {
    let connections = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.once("message", () => {})
    })
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      idleTimeout: 20,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest())
    expect(await first.text()).toBe("http")
    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())

    expect(await second.text()).toBe("http")
    expect(connections).toBe(1)
    expect(httpRequests).toHaveLength(2)
    fetch.close()
  })

  test("does not replay over HTTP after a websocket event was emitted", async () => {
    await using server = await createWebSocketServer((socket) => {
      socket.once("message", () => {
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "started" }))
      })
    })
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      idleTimeout: 20,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest())
    await expect(first.text()).rejects.toThrow("idle timeout waiting for websocket")
    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())

    expect(await second.text()).toBe("http")
    expect(httpRequests).toHaveLength(1)
    fetch.close()
  })

  test("falls back to HTTP for missing session and title requests", async () => {
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const missingSession = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { [TITLE_HEADER]: "false" },
      body: JSON.stringify({ stream: true }),
    })
    const title = await fetch("https://api.openai.com/v1/responses", streamRequest({ [TITLE_HEADER]: "true" }))

    expect(await missingSession.text()).toBe("http")
    expect(await title.text()).toBe("http")
    expect(httpRequests).toHaveLength(2)
    expect(httpRequests[0]?.get(TITLE_HEADER)).toBeNull()
    expect(httpRequests[1]?.get(TITLE_HEADER)).toBeNull()
    fetch.close()
  })

  test("falls back to HTTP while a websocket lane is busy", async () => {
    let connections = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.once("message", () => {
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "started" }))
      })
    })
    const abort = new AbortController()
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest({}, abort.signal))
    const firstText = first.text()
    await waitFor(() => connections === 1, "websocket did not connect")
    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())

    expect(await second.text()).toBe("http")
    expect(httpRequests).toHaveLength(1)
    expect(connections).toBe(1)
    abort.abort(new Error("stop"))
    await expect(firstText).rejects.toThrow("stop")
    fetch.close()
  })

  test("reserves a websocket lane while its socket is connecting", async () => {
    await using server = await createHangingTcpServer()
    let httpRequests = 0
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      connectTimeout: 20,
      httpFetch: mockFetch(async () => {
        httpRequests += 1
        return new Response("http")
      }),
    })

    const first = fetch("https://api.openai.com/v1/responses", streamRequest())
    await waitFor(() => server.connections() === 1, "first websocket did not begin connecting")
    const second = fetch("https://api.openai.com/v1/responses", streamRequest())

    expect(await (await second).text()).toBe("http")
    expect(await (await first).text()).toBe("http")
    expect(server.connections()).toBe(1)
    expect(httpRequests).toBe(2)
    fetch.close()
  })

  test("replays over HTTP after an unexpected close before the first event", async () => {
    let connections = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.once("message", () => {
        socket.close(1001, "server shutdown")
      })
    })
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest())
    expect(await first.text()).toBe("http")
    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())

    expect(await second.text()).toBe("http")
    expect(connections).toBe(1)
    expect(httpRequests).toHaveLength(2)
    fetch.close()
  })

  test("does not keep HTTP fallback active after aborting a websocket response", async () => {
    let connections = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.once("message", () => {
        if (connections === 1) {
          socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "started" }))
          return
        }
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_456" } }))
      })
    })
    const httpRequests: Headers[] = []
    const abort = new AbortController()
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest({}, abort.signal))
    const firstText = first.text()
    await waitFor(() => connections === 1, "first websocket did not connect")
    abort.abort(new Error("stop"))
    await expect(firstText).rejects.toThrow("stop")

    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())

    expect(await second.text()).toContain("data: [DONE]")
    expect(connections).toBe(2)
    expect(httpRequests).toHaveLength(0)
    fetch.close()
  })

  test("releases the websocket lane when the response body is cancelled", async () => {
    let connections = 0
    await using server = await createWebSocketServer((socket) => {
      connections += 1
      socket.once("message", () => {
        if (connections === 1) {
          socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "started" }))
          return
        }
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_after_cancel" } }))
      })
    })
    const httpRequests: Headers[] = []
    const fetch = OpenAIWebSocketPool.createWebSocketFetch({
      url: server.url,
      httpFetch: mockFetch(async (_input, init) => {
        httpRequests.push(new Headers(init?.headers))
        return new Response("http")
      }),
    })

    const first = await fetch("https://api.openai.com/v1/responses", streamRequest())
    await waitFor(() => connections === 1, "first websocket did not connect")
    await first.body!.cancel("stop")

    const second = await fetch("https://api.openai.com/v1/responses", streamRequest())

    expect(await second.text()).toContain("data: [DONE]")
    expect(connections).toBe(2)
    expect(httpRequests).toHaveLength(0)
    fetch.close()
  })
})

function streamRequest(headers?: Record<string, string>, signal?: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: {
      "session-id": "session-1",
      authorization: "Bearer test",
      ...headers,
    },
    body: JSON.stringify({ stream: true, input: "hi" }),
    signal,
  }
}

function mockFetch(
  fn: (
    input: Parameters<typeof globalThis.fetch>[0],
    init: Parameters<typeof globalThis.fetch>[1],
  ) => ReturnType<typeof globalThis.fetch>,
): typeof globalThis.fetch {
  return Object.assign(fn, { preconnect: globalThis.fetch.preconnect })
}

async function createWebSocketServer(onConnection: (socket: WebSocket, request: IncomingMessage) => void) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  server.on("connection", onConnection)
  await new Promise<void>((resolve) => server.once("listening", resolve))
  return websocketServerHandle(server)
}

async function createHangingTcpServer() {
  const sockets = new Set<Socket>()
  let connections = 0
  const server = net.createServer((socket) => {
    connections += 1
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/v1/responses`,
    wsUrl: `ws://127.0.0.1:${address.port}/v1/responses`,
    connections: () => connections,
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy()
      server.close()
    },
  }
}

async function createRejectingWebSocketServer(onAttempt: () => void) {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient(_info, callback) {
      onAttempt()
      callback(false, 401, "denied")
    },
  })
  await new Promise<void>((resolve) => server.once("listening", resolve))
  return websocketServerHandle(server)
}

function websocketServerHandle(server: WebSocketServer) {
  const address = server.address() as AddressInfo
  const url = `http://127.0.0.1:${address.port}/v1/responses`
  return {
    url,
    wsUrl: url.replace(/^http/, "ws"),
    async [Symbol.asyncDispose]() {
      for (const socket of server.clients) socket.terminate()
      server.close()
    },
  }
}

async function waitFor(predicate: () => boolean, message: string) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 1_000) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}
