import { describe, expect, test } from "bun:test"
import { authFromToken, authFromUrl, authTokenFromCredentials } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

describe("authFromUrl", () => {
  test("decodes basic auth credentials from a URL", () => {
    expect(authFromUrl("https://kit:secret@example.test")).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromUrl("https://:secret@example.test")).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores URLs without a password", () => {
    expect(authFromUrl("https://example.test")).toBeUndefined()
    expect(authFromUrl("not a url")).toBeUndefined()
  })
})
