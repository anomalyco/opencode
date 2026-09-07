import { describe, expect, test } from "bun:test"
import { decodePairingCode, serverAddress } from "./pairing"

describe("pairing code", () => {
  test("reads the JSON payload emitted by opencode pair", () => {
    expect(
      decodePairingCode(
        JSON.stringify({
          urls: ["http://192.168.1.20:4096", "http://[fd00::1]:4096"],
          username: "opencode",
          password: "test:password",
        }),
      ),
    ).toEqual({ urls: ["http://192.168.1.20:4096", "http://[fd00::1]:4096"], password: "test:password" })
  })

  test("normalizes and deduplicates addresses while dropping invalid addresses", () => {
    expect(
      decodePairingCode(
        JSON.stringify({
          urls: ["https://server.example/", "https://server.example", "file:///etc/passwd"],
          username: "opencode",
          password: "test-password",
        }),
      ),
    ).toEqual({ urls: ["https://server.example"], password: "test-password" })
  })

  test.each([
    "not json",
    "null",
    "[]",
    JSON.stringify({ urls: [], username: "opencode", password: "test" }),
    JSON.stringify({ urls: ["file:///etc/passwd"], username: "opencode", password: "test" }),
    JSON.stringify({ urls: [42], username: "opencode", password: "test" }),
    JSON.stringify({ urls: ["https://server.example"], username: "someone", password: "test" }),
    JSON.stringify({ urls: ["https://server.example"], username: "opencode", password: 42 }),
    JSON.stringify({ urls: ["https://server.example"], username: "opencode" }),
  ])("rejects an unrelated or malformed QR payload: %s", (value) => {
    expect(decodePairingCode(value)).toBeUndefined()
  })
})

describe("server address", () => {
  test("accepts a bare address and preserves an explicit server path", () => {
    expect(serverAddress(" 192.168.1.20:4096/ ")).toBe("http://192.168.1.20:4096")
    expect(serverAddress("https://server.example/opencode/")).toBe("https://server.example/opencode")
  })

  test.each([
    "",
    "http://",
    "file:///tmp/server",
    "https://user:password@server.example",
    "https://server.example?token=secret",
    "https://server.example#fragment",
  ])("rejects invalid or embedded connection data: %s", (value) => {
    expect(serverAddress(value)).toBeUndefined()
  })
})
