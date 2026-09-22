import { describe, expect, test } from "bun:test"
import { decodePairingCode, decodePairingUrl, pairingUrl } from "./pairing"

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
