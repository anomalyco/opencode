import { describe, expect, test } from "bun:test"
import { once } from "node:events"
import { createServer } from "node:http"
import { WebSocketServer } from "@effect/platform-node/NodeWS"
import { BrowserTunnelHost } from "@opencode/plugin-browser/experimental/stream"
import { SessionID } from "@opencode/schema/session-id"
import { Predicate } from "effect"
import {
  openAuthenticatedWebSocket,
  resolveBrowserTunnelUrl,
  TUNNEL_TICKET_HEADER,
  TunnelUpgradeError,
} from "./tunnel-client"

const sessionID = SessionID.make("ses_00000000000000000000000001")

describe("resolveBrowserTunnelUrl and openAuthenticatedWebSocket credential boundary", () => {
  test("derives fixed route from configured endpoint and preserves reverse-proxy base path prefix", () => {
    const cases = [
      ["https://proxy.example", "wss://proxy.example/api/experimental/browser/tunnel"],
      ["https://proxy.example/", "wss://proxy.example/api/experimental/browser/tunnel"],
      ["https://proxy.example/opencode", "wss://proxy.example/opencode/api/experimental/browser/tunnel"],
      ["https://proxy.example/opencode/", "wss://proxy.example/opencode/api/experimental/browser/tunnel"],
      ["http://127.0.0.1:4096/sub/path/", "ws://127.0.0.1:4096/sub/path/api/experimental/browser/tunnel"],
    ] as const

    for (const [serverUrl, expectedBase] of cases) {
      const resolved = resolveBrowserTunnelUrl({
        serverUrl,
        location: { directory: "/work/app" },
        replyPath: BrowserTunnelHost.BROWSER_TUNNEL_PATH,
      })

      expect(`${resolved.origin}${resolved.pathname}`).toBe(expectedBase)
      expect(resolved.searchParams.get("location[directory]")).toBe("/work/app")
      expect(resolved.searchParams.has("ticket")).toBe(false)
    }
  })

  test("refuses malformed or mismatched reply paths before opening a socket or sending credentials", async () => {
    let trapHits = 0

    const trapServer = createServer((_req, res) => {
      trapHits += 1
      res.writeHead(200).end()
    })

    trapServer.on("upgrade", (_req, socket) => {
      trapHits += 1
      socket.destroy()
    })

    await once(trapServer.listen(0, "127.0.0.1"), "listening")
    const trapAddr = trapServer.address()

    if (!trapAddr || Predicate.isString(trapAddr)) throw new Error("No trap server address")

    const hostilePaths = [
      `http://127.0.0.1:${trapAddr.port}/api/experimental/browser/tunnel`,
      `ws://127.0.0.1:${trapAddr.port}/api/experimental/browser/tunnel`,
      `//127.0.0.1:${trapAddr.port}/api/experimental/browser/tunnel`,
      `https://127.0.0.1:${trapAddr.port}/steal`,
      "/api/other",
      "/api/experimental/browser/tunnel?extra=1",
      "/api/experimental/browser/tunnel#frag",
      "/api/experimental/../other",
      "\\127.0.0.1\\steal",
      "",
    ]

    try {
      for (const path of hostilePaths) {
        let caught: Error | undefined

        try {
          await openAuthenticatedWebSocket({
            server: {
              id: "remote",
              url: "http://127.0.0.1:1/opencode",
              headers: { authorization: "Basic c2VjcmV0OnRva2Vu" },
              sameMachine: false,
            },
            location: { directory: "/work" },
            attachment: { sessionID, connectionID: "conn_1" },
            ticket: "tkt_sensitive_test_value",
            path,
            protocol: 1,
          })
        } catch (error) {
          caught = error instanceof Error ? error : new Error(String(error))
        }

        expect(caught).toBeInstanceOf(TunnelUpgradeError)
        expect(caught instanceof TunnelUpgradeError ? caught.kind : undefined).toBe("protocol")
      }

      // Give the event loop a turn to prove no outbound socket dial ever started.
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
      expect(trapHits).toBe(0)
    } finally {
      trapServer.closeAllConnections()
      await new Promise<void>((resolve) => trapServer.close(() => resolve()))
    }
  })

  test("upgrades against a prefixed reverse-proxy base URL with ticket in header and no cookie forwarding", async () => {
    interface SeenUpgrade {
      url?: string
      ticket?: string
      auth?: string
      cookie?: string
    }

    const seen: SeenUpgrade = {}
    const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
    const server = createServer((_req, res) => res.writeHead(404).end())

    server.on("upgrade", (req, socket, head) => {
      seen.url = req.url
      seen.ticket = Predicate.isString(req.headers[TUNNEL_TICKET_HEADER]) ? req.headers[TUNNEL_TICKET_HEADER] : undefined
      seen.auth = Predicate.isString(req.headers.authorization) ? req.headers.authorization : undefined
      seen.cookie = Predicate.isString(req.headers.cookie) ? req.headers.cookie : undefined
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
    })

    await once(server.listen(0, "127.0.0.1"), "listening")
    const addr = server.address()

    if (!addr || Predicate.isString(addr)) throw new Error("No prefixed server address")

    try {
      const ws = await openAuthenticatedWebSocket({
        server: {
          id: "remote",
          url: `http://127.0.0.1:${addr.port}/opencode/proxy/`,
          headers: { authorization: "Basic dGVzdDp0ZXN0", cookie: "session=must-not-send" },
          sameMachine: false,
        },
        location: { directory: "/work/repo" },
        attachment: { sessionID, connectionID: "conn_prefixed" },
        ticket: "tkt_prefixed_ok",
        path: BrowserTunnelHost.BROWSER_TUNNEL_PATH,
        protocol: 1,
      })

      expect(seen.url).toBe("/opencode/proxy/api/experimental/browser/tunnel?location%5Bdirectory%5D=%2Fwork%2Frepo")
      expect(seen.ticket).toBe("tkt_prefixed_ok")
      expect(seen.auth).toBe("Basic dGVzdDp0ZXN0")
      expect(seen.cookie).toBeUndefined()
      ws.close(1000, "done")
    } finally {
      wss.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
