import { describe, expect, test } from "bun:test"
import { pairingLink } from "./pairing"

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

  test("tries the default QR address first", () => {
    expect(
      pairingLink(
        JSON.stringify({
          code: "abc",
          url: "http://100.64.0.3:49374",
          urls: ["http://192.168.1.2:49374", "http://100.64.0.3:49374"],
        }),
      ),
    ).toEqual({ urls: ["http://100.64.0.3:49374", "http://192.168.1.2:49374"], code: "abc" })
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
})
