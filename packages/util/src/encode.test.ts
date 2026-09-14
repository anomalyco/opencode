import { describe, expect, test } from "bun:test"
import { base64Decode, base64Encode, checksum, sampledChecksum } from "./encode.js"

describe("frontend encoding", () => {
  test("uses unpadded URL-safe UTF-8 base64", () => {
    expect(base64Encode("hello")).toBe("aGVsbG8")
    expect(base64Encode("✓ à la mode")).toBe("4pyTIMOgIGxhIG1vZGU")
    expect(base64Decode("4pyTIMOgIGxhIG1vZGU")).toBe("✓ à la mode")
    expect(base64Decode("dXNlcjpwYXNz")).toBe("user:pass")
  })

  test("rejects invalid base64", () => {
    expect(() => base64Decode("%%%")).toThrow()
  })

  test("keeps stable FNV checksums", () => {
    expect(checksum("")).toBeUndefined()
    expect(checksum("hello")).toBe("m3bicr")
    expect(checksum("✓ à la mode")).toBe("jmczk0")
  })

  test("samples large values without changing the size boundary", () => {
    const value = "abcdef".repeat(100)
    expect(sampledChecksum(value, value.length)).toBe(checksum(value))
    expect(sampledChecksum(value, value.length - 1)).toBe("600:1isj1k5:1isj1k5:1isj1k5:1isj1k5:1isj1k5")
  })
})
