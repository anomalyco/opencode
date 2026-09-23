import { describe, expect, test } from "bun:test"
import { decodePairingCode, decodePairingScan, decodePairingUrl, pairingLink, pairingUrl } from "./pairing"

describe("pairing URL", () => {
  test("pairs with the current origin using credentials without server URLs", () => {
    const info = { username: "opencode" as const, password: "a+b & café" }
    const origin = "https://opencode.example.com:49709"
    const url = new URL(pairingUrl(info, origin))

    expect(url.origin).toBe(origin)
    expect(url.pathname).toBe("/connect")
    expect(url.search).toBe("")
    expect(url.hash).not.toBe("")
    expect(decodePairingUrl(url.hash, origin)).toEqual({ urls: [origin], password: info.password })
    expect(decodePairingCode(JSON.stringify(info))).toBeUndefined()
  })

  test("keeps accepting query pairing data", () => {
    const info = { urls: ["http://192.168.1.2:4096"], username: "opencode", password: "a+b & café" }
    expect(decodePairingUrl(`?data=${encodeURIComponent(JSON.stringify(info))}`)).toEqual({
      urls: info.urls,
      password: info.password,
    })
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

describe("pairing scan", () => {
  const info = {
    urls: ["http://192.168.1.2:49374", "http://127.0.0.1:49374"],
    username: "opencode" as const,
    password: "a+b & café",
  }

  test("decodes the raw JSON code", () => {
    expect(decodePairingScan(JSON.stringify(info))).toEqual({ urls: info.urls, password: info.password })
  })

  test("decodes a direct /connect URL", () => {
    expect(
      decodePairingScan(pairingUrl({ username: info.username, password: info.password }, "http://192.168.1.2:49374")),
    ).toEqual({
      urls: ["http://192.168.1.2:49374"],
      password: info.password,
    })
  })

  test("keeps accepting /connect URLs with query data", () => {
    expect(
      decodePairingScan(`http://192.168.1.2:49374/connect?data=${encodeURIComponent(JSON.stringify(info))}`),
    ).toEqual({
      urls: info.urls,
      password: info.password,
    })
  })

  test("falls back to the URL origin when the payload omits server URLs", () => {
    const origin = "https://opencode.example.com:49709"
    expect(decodePairingScan(pairingUrl({ username: "opencode", password: "secret" }, origin))).toEqual({
      urls: [origin],
      password: "secret",
    })
  })

  test("rejects URLs without pairing data and non-http schemes", () => {
    expect(decodePairingScan("http://192.168.1.2:49374/connect")).toBeUndefined()
    expect(decodePairingScan("https://example.com/?data=invalid")).toBeUndefined()
    expect(decodePairingScan("opencode-ios://connect?password=secret")).toBeUndefined()
    expect(decodePairingScan("not a code")).toBeUndefined()
  })
})

describe("pairing link", () => {
  test("reads the server address and code from opencode pair links", () => {
    expect(pairingLink(" http://192.168.1.2:49374/auth/connect/abc_DEF-123 ")).toEqual({
      url: "http://192.168.1.2:49374",
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
})
