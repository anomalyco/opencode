import { describe, expect, test } from "bun:test"
import { bareServerAddress, legacyPairingLink, pairingLink, redeemPairingLink } from "./pairing"

describe("pairing link", () => {
  test("reads the server address and code from opencode pair links", () => {
    expect(pairingLink(" http://192.168.1.2:49374/auth/connect/abc_DEF-123 ")).toEqual({
      urls: ["http://192.168.1.2:49374"],
      code: "abc_DEF-123",
    })
  })

  test("reads every server address from opencode pair QR codes", () => {
    expect(
      pairingLink(
        JSON.stringify({ code: "abc_DEF-123", urls: ["http://192.168.1.2:49374", "http://100.64.0.3:49374"] }),
      ),
    ).toEqual({
      urls: ["http://192.168.1.2:49374", "http://100.64.0.3:49374"],
      code: "abc_DEF-123",
    })
  })

  test("rejects other URLs", () => {
    expect(pairingLink("http://192.168.1.2:49374/auth/connect/")).toBeUndefined()
    expect(pairingLink("http://192.168.1.2:49374/auth/connect/abc/extra")).toBeUndefined()
    expect(pairingLink("http://192.168.1.2:49374/connect#abc")).toBeUndefined()
    expect(pairingLink("opencode-ios://auth/connect/abc")).toBeUndefined()
    expect(pairingLink("192.168.1.2:49374")).toBeUndefined()
  })

  test("rejects malformed QR payloads", () => {
    expect(pairingLink(JSON.stringify({ code: "abc", urls: [] }))).toBeUndefined()
    expect(pairingLink(JSON.stringify({ code: "a/b", urls: ["http://192.168.1.2:49374"] }))).toBeUndefined()
    expect(pairingLink(JSON.stringify({ code: "abc", urls: ["opencode-ios://host"] }))).toBeUndefined()
    expect(pairingLink(JSON.stringify({ urls: ["http://192.168.1.2:49374"] }))).toBeUndefined()
    expect(pairingLink("{not json")).toBeUndefined()
  })

  test("treats only a host without a path as a server address typed into the pairing link field", () => {
    expect(bareServerAddress("192.168.1.2:4096")).toBe("http://192.168.1.2:4096")
    expect(bareServerAddress("https://opencode.example.com/")).toBe("https://opencode.example.com")
    expect(bareServerAddress("localhost")).toBe("http://localhost")
    expect(bareServerAddress("devbox:4096")).toBe("http://devbox:4096")
    expect(bareServerAddress("[::1]:4096")).toBe("http://[::1]:4096")
    expect(bareServerAddress("abc_DEF-123")).toBeUndefined()
    expect(bareServerAddress("http://192.168.1.2:4096/auth/connect/")).toBeUndefined()
    expect(bareServerAddress("http://192.168.1.2:4096/auth/connect/…")).toBeUndefined()
    expect(bareServerAddress("http://192.168.1.2:4096/connect")).toBeUndefined()
  })

  test("recognizes the credential links that servers printed before one-time links", () => {
    expect(legacyPairingLink("http://192.168.1.2:49374/connect#eyJ1c2VybmFtZSI6Im9wZW5jb2RlIn0")).toBe(true)
    expect(legacyPairingLink("http://192.168.1.2:49374/connect?data=eyJ1c2VybmFtZSI6Im9wZW5jb2RlIn0")).toBe(true)
    expect(legacyPairingLink("http://192.168.1.2:49374/connect")).toBe(false)
    expect(legacyPairingLink("http://192.168.1.2:49374/auth/connect/abc")).toBe(false)
  })
})

test("redeems codes on servers that predate POST redemption", async () => {
  const methods: string[] = []
  const reply = (status: string, body = "") =>
    `HTTP/1.1 ${status}\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\naccess-control-allow-origin: *\r\naccess-control-allow-methods: GET, POST\r\nconnection: close\r\n\r\n${body}`
  // Servers before POST redemption have no POST route for pairing links and redeem the code on GET.
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, chunk) {
        const method = String(chunk).split(" ")[0] ?? ""
        methods.push(method)
        if (method === "OPTIONS") return void socket.end(reply("204 No Content"))
        if (method !== "GET") return void socket.end(reply("404 Not Found"))
        socket.end(reply("200 OK", JSON.stringify({ token: "session-token" })))
      },
    },
  })
  const url = `http://127.0.0.1:${server.port}`

  try {
    expect(await redeemPairingLink({ urls: [url], code: "abc" })).toEqual({
      type: "paired",
      pairing: { url, password: "session-token" },
    })
    // happy-dom's fetch may add CORS preflights; only the POST and the GET reach the pairing route.
    expect(methods.filter((method) => method !== "OPTIONS")).toEqual(["POST", "GET"])
  } finally {
    server.stop(true)
  }
})
