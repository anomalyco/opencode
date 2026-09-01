import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials } from "./api"

describe("authFromToken", () => {
  test("extracts only the password from auth_token", () => {
    expect(authFromToken(btoa("opencode:secret"))).toEqual({ password: "secret" })
  })

  test("ignores legacy usernames and preserves colons in passwords", () => {
    expect(authFromToken(btoa("legacy:secret:with:colons"))).toEqual({ password: "secret:with:colons" })
    expect(authFromToken(btoa(":secret"))).toEqual({ password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the fixed username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })

  test("ignores usernames in legacy saved credentials", () => {
    const credentials = { username: "legacy", password: "secret" }
    expect(authTokenFromCredentials(credentials)).toBe(btoa("opencode:secret"))
  })
})
