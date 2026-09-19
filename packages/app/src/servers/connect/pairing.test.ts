import { describe, expect, test } from "bun:test"
import { decodePairingCode, decodePairingUrl, pairingUrl } from "./pairing"

describe("pairing URL", () => {
  test("pairs with the current origin using credentials without server URLs", () => {
    const info = { username: "opencode" as const, password: "a+b & café" }
    const origin = "https://computer.tailnet.ts.net:49709"
    const url = new URL(pairingUrl(info, origin))

    expect(url.origin).toBe(origin)
    expect(url.pathname).toBe("/connect")
    expect(JSON.parse(url.searchParams.get("data") ?? "")).toEqual(info)
    expect(decodePairingUrl(url.search, origin)).toEqual({ urls: [origin], password: info.password })
    expect(decodePairingCode(JSON.stringify(info))).toBeUndefined()
  })

  test("encodes the pairing JSON in the data query parameter and decodes it", () => {
    const info = {
      urls: ["http://192.168.1.2:4096"],
      username: "opencode" as const,
      password: "a+b & café",
    }
    const url = new URL(pairingUrl(info, "https://example.com"))

    expect(url.origin).toBe("https://example.com")
    expect(url.pathname).toBe("/connect")
    expect(url.searchParams.get("data")).toBe(JSON.stringify(info))
    expect(decodePairingUrl(url.search)).toEqual({
      urls: ["http://192.168.1.2:4096"],
      password: "a+b & café",
    })
  })

  test("defaults to the hosted app for desktop pairing", () => {
    expect(new URL(pairingUrl({ urls: [], username: "opencode", password: "secret" })).origin).toBe(
      "https://app.opencode.ai",
    )
  })

  test("accepts CLI base64url fragments", () => {
    const value = { urls: ["http://localhost:4096"], username: "opencode", password: "a+b & café" }
    expect(decodePairingUrl(`#${Buffer.from(JSON.stringify(value)).toString("base64url")}`)).toEqual({
      urls: value.urls,
      password: value.password,
    })
  })

  test("rejects invalid query data", () => {
    expect(decodePairingUrl("?data=invalid")).toBeUndefined()
    expect(decodePairingUrl("?other=value")).toBeUndefined()
  })

  test("accepts legacy JSON fragments", () => {
    const value = { urls: ["http://localhost:4096"], username: "opencode", password: "secret" }
    expect(decodePairingUrl(`#${encodeURIComponent(JSON.stringify(value))}`)).toEqual({
      urls: value.urls,
      password: value.password,
    })
  })

  test("rejects an invalid fragment", () => {
    expect(decodePairingUrl("#not-a-pairing-code")).toBeUndefined()
  })
})
