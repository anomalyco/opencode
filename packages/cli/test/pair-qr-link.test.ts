import { describe, expect, test } from "bun:test"
import { reachablePairingLink } from "../src/commands/handlers/pair"

describe("reachablePairingLink", () => {
  test("builds a plain connect URL from the first non-loopback address", () => {
    expect(reachablePairingLink(["http://192.168.1.2:4096", "http://10.0.0.5:4096"], "abc_DEF-123")).toBe(
      "http://192.168.1.2:4096/auth/connect/abc_DEF-123",
    )
  })

  test("skips loopback addresses a scanning device cannot reach", () => {
    expect(reachablePairingLink(["http://localhost:4096", "http://127.0.0.1:4096", "http://[::1]:4096"], "code")).toBeUndefined()
    expect(reachablePairingLink(["http://127.0.0.1:4096", "https://oc.example.com"], "code")).toBe(
      "https://oc.example.com/auth/connect/code",
    )
  })

  test("prefers a LAN address over a Docker bridge", () => {
    expect(
      reachablePairingLink(["http://172.17.0.1:4096", "http://192.168.1.2:4096", "http://10.0.0.5:4096"], "code"),
    ).toBe("http://192.168.1.2:4096/auth/connect/code")
  })

})
