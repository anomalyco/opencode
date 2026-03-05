import { test, expect, describe } from "bun:test"
import { getAttachHeaders } from "../../src/cli/cmd/run"

describe("getAttachHeaders", () => {
  test("returns auth headers when password is set", () => {
    const headers = getAttachHeaders("secret")
    expect(headers).toEqual({
      Authorization: `Basic ${Buffer.from("opencode:secret").toString("base64")}`,
    })
  })

  test("uses custom username when provided", () => {
    const headers = getAttachHeaders("secret", "admin")
    expect(headers).toEqual({
      Authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`,
    })
  })

  test("defaults username to opencode", () => {
    const headers = getAttachHeaders("secret")
    const decoded = atob(headers!.Authorization.replace("Basic ", ""))
    expect(decoded).toBe("opencode:secret")
  })

  test("returns undefined when no password", () => {
    expect(getAttachHeaders(undefined)).toBeUndefined()
    expect(getAttachHeaders("")).toBeUndefined()
  })
})
