import { describe, expect, test } from "bun:test"
import { ProxyUtil } from "../../src/server/proxy-util"

describe("ProxyUtil", () => {
  describe("websocketTargetURL", () => {
    test("converts http to ws", () => {
      expect(ProxyUtil.websocketTargetURL("http://example.com/path")).toBe("ws://example.com/path")
    })

    test("converts https to wss", () => {
      expect(ProxyUtil.websocketTargetURL("https://example.com/path")).toBe("wss://example.com/path")
    })

    test("preserves query params", () => {
      expect(ProxyUtil.websocketTargetURL("http://example.com/path?foo=bar")).toBe("ws://example.com/path?foo=bar")
    })

    test("accepts URL objects", () => {
      expect(ProxyUtil.websocketTargetURL(new URL("http://localhost:3000/ws"))).toBe("ws://localhost:3000/ws")
    })
  })

  describe("websocketProtocols", () => {
    test("returns empty array when no header", () => {
      const req = new Request("http://localhost")
      expect(ProxyUtil.websocketProtocols(req)).toEqual([])
    })

    test("parses single protocol", () => {
      const req = new Request("http://localhost", {
        headers: { "sec-websocket-protocol": "graphql-ws" },
      })
      expect(ProxyUtil.websocketProtocols(req)).toEqual(["graphql-ws"])
    })

    test("parses multiple protocols", () => {
      const req = new Request("http://localhost", {
        headers: { "sec-websocket-protocol": "graphql-ws, graphql-transport-ws" },
      })
      expect(ProxyUtil.websocketProtocols(req)).toEqual(["graphql-ws", "graphql-transport-ws"])
    })

    test("trims whitespace and filters empty", () => {
      const req = new Request("http://localhost", {
        headers: { "sec-websocket-protocol": " proto1 , , proto2 " },
      })
      expect(ProxyUtil.websocketProtocols(req)).toEqual(["proto1", "proto2"])
    })
  })

  describe("headers", () => {
    test("strips hop-by-hop headers", () => {
      const req = new Request("http://localhost", {
        headers: {
          connection: "keep-alive",
          "keep-alive": "timeout=5",
          "transfer-encoding": "chunked",
          "content-type": "application/json",
        },
      })
      const result = ProxyUtil.headers(req)
      expect(result.get("connection")).toBeNull()
      expect(result.get("keep-alive")).toBeNull()
      expect(result.get("transfer-encoding")).toBeNull()
      expect(result.get("content-type")).toBe("application/json")
    })

    test("strips opencode-specific headers", () => {
      const req = new Request("http://localhost", {
        headers: {
          "x-opencode-directory": "/home/user/project",
          "x-opencode-workspace": "ws_123",
          "accept-encoding": "gzip",
          "x-custom": "keep",
        },
      })
      const result = ProxyUtil.headers(req)
      expect(result.get("x-opencode-directory")).toBeNull()
      expect(result.get("x-opencode-workspace")).toBeNull()
      expect(result.get("accept-encoding")).toBeNull()
      expect(result.get("x-custom")).toBe("keep")
    })

    test("merges extra headers", () => {
      const req = new Request("http://localhost", {
        headers: { "content-type": "application/json" },
      })
      const result = ProxyUtil.headers(req, { "x-auth": "token", "content-type": "text/plain" })
      expect(result.get("x-auth")).toBe("token")
      expect(result.get("content-type")).toBe("text/plain")
    })

    test("returns original headers when no extra", () => {
      const req = new Request("http://localhost", {
        headers: { "content-type": "application/json", "x-foo": "bar" },
      })
      const result = ProxyUtil.headers(req)
      expect(result.get("content-type")).toBe("application/json")
      expect(result.get("x-foo")).toBe("bar")
    })

    test("accepts plain object (HeadersInit) as input", () => {
      const result = ProxyUtil.headers(
        { "content-type": "application/json", connection: "keep-alive", "x-custom": "val" },
        { "x-extra": "added" },
      )
      expect(result.get("connection")).toBeNull()
      expect(result.get("content-type")).toBe("application/json")
      expect(result.get("x-custom")).toBe("val")
      expect(result.get("x-extra")).toBe("added")
    })
  })
})
