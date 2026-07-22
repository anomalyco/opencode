import { describe, expect, test } from "bun:test"
import { extractIdentity } from "../../src/auth/jwt"

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function makeJwt(payload: object, header: object = { alg: "RS256", typ: "JWT" }): string {
  const h = Buffer.from(JSON.stringify(header), "utf8").toString("base64url")
  const p = encodePayload(payload)
  return `${h}.${p}.sig`
}

describe("extractIdentity", () => {
  test("returns all identity fields from a fully-populated id_token", () => {
    const token = makeJwt({
      oid: "guid-abc",
      preferred_username: "alice@contoso.com",
      name: "Alice Smith",
      tid: "tenant-1",
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity).toEqual({
      email: "alice@contoso.com",
      displayName: "Alice Smith",
      tenantId: "tenant-1",
    })
  })

  test("returns null for undefined token", () => {
    expect(extractIdentity(undefined)).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(extractIdentity("")).toBeNull()
  })

  test("returns null for malformed JWT", () => {
    expect(extractIdentity("not-a-jwt")).toBeNull()
  })

  test("returns partial identity when only email (preferred_username) is present", () => {
    const token = makeJwt({
      oid: "guid-abc",
      preferred_username: "bob@contoso.com",
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity?.email).toBe("bob@contoso.com")
    expect(identity?.displayName).toBeUndefined()
    expect(identity?.tenantId).toBeUndefined()
  })

  test("returns null when oid claim is missing (parseJwtClaims returns null)", () => {
    const token = makeJwt({
      preferred_username: "alice@contoso.com",
      name: "Alice Smith",
    })

    expect(extractIdentity(token)).toBeNull()
  })

  test("does not throw on any input", () => {
    expect(() => extractIdentity("...")).not.toThrow()
    expect(() => extractIdentity("a.b.c")).not.toThrow()
    expect(() => extractIdentity("a.b.c.d")).not.toThrow()
  })
})
