import { test, expect, describe } from "bun:test"
import { getAuthorizationHeader } from "../../src/util/auth"

describe("getAuthorizationHeader", () => {
  test("returns undefined when no password", () => {
    expect(getAuthorizationHeader(undefined)).toBeUndefined()
    expect(getAuthorizationHeader("")).toBeUndefined()
  })

  test("returns basic auth with default username", () => {
    expect(getAuthorizationHeader("secret")).toBe(`Basic ${btoa("opencode:secret")}`)
  })

  test("uses custom username when provided", () => {
    expect(getAuthorizationHeader("secret", "admin")).toBe(`Basic ${btoa("admin:secret")}`)
  })
})
