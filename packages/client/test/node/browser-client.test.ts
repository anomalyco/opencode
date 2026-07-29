import { BrowserControlProtocol } from "@opencode-ai/protocol/browser-control"
import { BrowserControl } from "@opencode-ai/schema/browser-control"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { once } from "node:events"
import { createServer } from "node:http"
import WebSocket, { WebSocketServer } from "ws"
import { Browser, BrowserDriver, OpenCode } from "@opencode-ai/client/node"

const state: Browser.State = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}

describe("Node browser client", () => {
  test("registers one Session and handles attach, command, detach, and open", async () => {
    const server = await controlServer()
    let opened = 0
    let disposed = 0
    const client = OpenCode.make({ baseUrl: server.url })
    try {
      const registering = client.browser.register({ sessionID: "ses_node_browser", open: () => opened++ })
      const socket = await server.connected
      const next = reader(socket)
      expect(await next()).toEqual({ type: "browser.control.register", sessionID: "ses_node_browser" })
      socket.send(BrowserControlProtocol.encodeFromServer({ type: "browser.control.registered" }))
      const registration = await registering

      socket.send(BrowserControlProtocol.encodeFromServer({ type: "browser.control.open" }))
      await waitFor(() => opened === 1)
      expect(opened).toBe(1)

      const attaching = registration.attach({
        driver: BrowserDriver.define(({ proxy }) => ({
          resource: proxy,
          state: () => state,
          subscribe: () => () => undefined,
          execute: async () => ({ type: "snapshot", state, format: "opencode.semantic.v1", content: "snapshot" }),
          dispose: () => disposed++,
        })),
      })
      const attach = await next()
      if (attach.type !== "browser.control.attach") throw new Error("expected browser attach")
      expect(attach.state).toEqual(state)
      socket.send(
        BrowserControlProtocol.encodeFromServer({ type: "browser.control.attached", leaseID: attach.leaseID }),
      )
      const attachment = await attaching
      expect(attachment.resource.url.startsWith("http://127.0.0.1:")).toBe(true)
      expect((await next()).type).toBe("browser.control.state")

      const requestID = BrowserControl.RequestID.create()
      socket.send(
        BrowserControlProtocol.encodeFromServer({
          type: "browser.control.request",
          requestID,
          leaseID: attach.leaseID,
          command: { type: "snapshot", generation: 1 },
        }),
      )
      expect(await next()).toMatchObject({
        type: "browser.control.response",
        requestID,
        outcome: { type: "success", result: { type: "snapshot", content: "snapshot" } },
      })

      await attachment.close()
      expect(await next()).toEqual({ type: "browser.control.detach", leaseID: attach.leaseID })
      expect(socket.readyState).toBe(WebSocket.OPEN)
      expect(disposed).toBe(1)
      const closed = once(socket, "close")
      await registration.close()
      await closed
    } finally {
      await server.close()
    }
  })

})

async function controlServer(authorization?: string) {
  const http = createServer((request, response) => {
    response.statusCode = request.headers.authorization === authorization ? 200 : 401
    response.end()
  })
  const webSockets = new WebSocketServer({ noServer: true })
  let resolveConnected!: (socket: WebSocket) => void
  const connected = new Promise<WebSocket>((resolve) => {
    resolveConnected = resolve
  })
  webSockets.once("connection", resolveConnected)
  http.on("upgrade", (request, socket, head) => {
    if (
      request.url !== BrowserControlProtocol.Path ||
      request.headers.authorization !== authorization ||
      request.headers["sec-websocket-protocol"] !== BrowserControlProtocol.Subprotocol
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
      return
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request))
  })
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  const address = http.address()
  if (!address || typeof address === "string") throw new Error("control server did not bind")
  return {
    connected,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      webSockets.clients.forEach((socket) => socket.terminate())
      webSockets.close()
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}

function reader(socket: WebSocket) {
  const queued: WebSocket.RawData[] = []
  const waiting: Array<(data: WebSocket.RawData) => void> = []
  socket.on("message", (data, binary) => {
    if (binary) throw new Error("expected text control message")
    const resolve = waiting.shift()
    if (resolve) resolve(data)
    else queued.push(data)
  })
  return async () => {
    const data = queued.shift() ?? (await new Promise<WebSocket.RawData>((resolve) => waiting.push(resolve)))
    return Effect.runPromise(BrowserControlProtocol.decodeFromClient(Buffer.from(rawData(data)).toString("utf8")))
  }
}

function rawData(data: WebSocket.RawData) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw new Error("timed out waiting for browser client")
}
