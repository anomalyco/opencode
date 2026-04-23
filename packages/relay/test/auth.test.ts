import { describe, expect, it } from "bun:test"
import { mintToken, readBearer, verifyToken } from "../src/auth"

describe("relay auth", () => {
  it("round-trips claims through HMAC", async () => {
    const token = await mintToken("secret", { kind: "tunnel", pairId: "abc" })
    const claims = await verifyToken("secret", token)
    expect(claims).not.toBeNull()
    expect(claims!.kind).toBe("tunnel")
    expect(claims!.pairId).toBe("abc")
  })

  it("rejects tokens signed with a different secret", async () => {
    const token = await mintToken("secret-a", { kind: "client", pairId: "abc" })
    expect(await verifyToken("secret-b", token)).toBeNull()
  })

  it("rejects tampered payloads", async () => {
    const token = await mintToken("secret", { kind: "client", pairId: "abc" })
    const [payload, sig] = token.split(".")
    const tampered = payload!.replace(/.$/, (c) => (c === "a" ? "b" : "a")) + "." + sig
    expect(await verifyToken("secret", tampered)).toBeNull()
  })

  it("parses Authorization: Bearer", () => {
    expect(readBearer("Bearer abc123")).toBe("abc123")
    expect(readBearer("bearer abc123")).toBe("abc123")
    expect(readBearer("Basic abc123")).toBeNull()
    expect(readBearer(null)).toBeNull()
    expect(readBearer(undefined)).toBeNull()
  })
})
