import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials } from "./server"

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

  test("encodes unicode credentials as UTF-8", () => {
    expect(authTokenFromCredentials({ password: "päss" })).toBe(
      Buffer.from("opencode:päss", "utf8").toString("base64"),
    )
  })

  test("round trips multibyte credentials", () => {
    const token = authTokenFromCredentials({ username: "用户", password: "秘密🔐" })
    expect(authFromToken(token)).toEqual({ username: "用户", password: "秘密🔐" })
  })
})
