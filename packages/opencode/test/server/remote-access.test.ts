import { describe, expect, test } from "bun:test"
import { buildRemoteURL } from "../../src/server/remote-pairing"
import { RemoteAccess } from "../../src/server/remote-access"

describe("remote access", () => {
  test("accepts an explicit private LAN host", () => {
    expect(RemoteAccess.resolveHost("lan", "192.168.1.10")).toBe("192.168.1.10")
  })

  test("rejects a public LAN host", () => {
    expect(() => RemoteAccess.resolveHost("lan", "8.8.8.8")).toThrow(/private LAN IP/)
  })

  test("defaults tailnet mode to loopback", () => {
    expect(RemoteAccess.resolveHost("tailnet")).toBe("127.0.0.1")
  })

  test("rejects non-loopback tailnet hosts", () => {
    expect(() => RemoteAccess.resolveHost("tailnet", "192.168.1.10")).toThrow(/loopback IP/)
  })

  test("allows only private clients in LAN mode", () => {
    expect(RemoteAccess.allows("lan", "::ffff:192.168.1.50")).toBeTrue()
    expect(RemoteAccess.allows("lan", "::ffff:127.0.0.1")).toBeTrue()
    expect(RemoteAccess.allows("lan", "8.8.8.8")).toBeFalse()
  })

  test("allows only loopback clients in tailnet mode", () => {
    expect(RemoteAccess.allows("tailnet", "::ffff:127.0.0.1")).toBeTrue()
    expect(RemoteAccess.allows("tailnet", "::1")).toBeTrue()
    expect(RemoteAccess.allows("tailnet", "::ffff:192.168.1.50")).toBeFalse()
  })

  test("preserves path prefixes when building remote URLs", () => {
    expect(
      buildRemoteURL("https://phone.example/opencode-remote-123/", {
        directory: "/tmp/demo",
        token: "tok",
        expiresAt: 1,
        sessionID: "sess",
      }),
    ).toBe("https://phone.example/opencode-remote-123/remote?token=tok&sessionID=sess")
  })
})
