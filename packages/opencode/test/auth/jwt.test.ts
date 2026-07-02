import { describe, expect, test } from "bun:test"
import { parseJwtClaims } from "../../src/auth/jwt"

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function makeJwt(payload: object, header: object = { alg: "RS256", typ: "JWT" }): string {
  const h = Buffer.from(JSON.stringify(header), "utf8").toString("base64url")
  const p = encodePayload(payload)
  // signature is irrelevant — we never verify
  return `${h}.${p}.sig`
}

describe("parseJwtClaims", () => {
  test("returns all four claims for a fully-populated Microsoft ID token", () => {
    const token = makeJwt({
      oid: "guid-abc",
      preferred_username: "alice@contoso.com",
      name: "Alice Smith",
      tid: "tenant-1",
    })

    const claims = parseJwtClaims(token)
    expect(claims).not.toBeNull()
    expect(claims).toEqual({
      oid: "guid-abc",
      preferred_username: "alice@contoso.com",
      name: "Alice Smith",
      tid: "tenant-1",
    })
  })

  test("returns null when oid claim is missing", () => {
    const token = makeJwt({
      preferred_username: "alice@contoso.com",
      name: "Alice Smith",
      tid: "tenant-1",
    })

    expect(parseJwtClaims(token)).toBeNull()
  })

  test("returns null for a token whose payload is not valid base64url", () => {
    // The second segment is "!!!not-base64!!!"
    const token = `${Buffer.from("h", "utf8").toString("base64url")}.!!!not-base64!!!.sig`
    expect(parseJwtClaims(token)).toBeNull()
  })

  test("returns null for an empty string", () => {
    expect(parseJwtClaims("")).toBeNull()
  })

  test("returns the claims object with only oid when other claims are absent", () => {
    const token = makeJwt({ oid: "guid-only" })

    const claims = parseJwtClaims(token)
    expect(claims).not.toBeNull()
    expect(claims?.oid).toBe("guid-only")
    expect(claims?.preferred_username).toBeUndefined()
    expect(claims?.name).toBeUndefined()
    expect(claims?.tid).toBeUndefined()
  })

  test("returns null for a token whose payload is not valid JSON", () => {
    const garbage = Buffer.from("not json {{{", "utf8").toString("base64url")
    const token = `${Buffer.from("h", "utf8").toString("base64url")}.${garbage}.sig`
    expect(parseJwtClaims(token)).toBeNull()
  })

  test("returns null when the token has fewer than three segments", () => {
    expect(parseJwtClaims("only.two")).toBeNull()
    expect(parseJwtClaims("onlyone")).toBeNull()
  })

  test("does not throw on malformed input", () => {
    expect(() => parseJwtClaims("...")).not.toThrow()
    expect(() => parseJwtClaims("a.b.c.d")).not.toThrow()
  })
})
