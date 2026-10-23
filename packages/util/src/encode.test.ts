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

  test("rejects base64 whose bytes are not valid UTF-8", () => {
    // "app" is valid base64, but its bytes (6a 9a) are not valid UTF-8. A non-fatal decoder
    // would return "j\uFFFD" instead of failing, leaking mojibake into paths and route keys.
    expect(() => base64Decode("app")).toThrow()
  })

  test("keeps a replacement character that was legitimately encoded", () => {
    // U+FFFD as real UTF-8 is valid input and must round-trip. Rejecting it would mean filtering
    // on the decoded character rather than on invalid bytes, which breaks paths that contain one.
    const value = "j\uFFFD"
    expect(base64Decode(base64Encode(value))).toBe(value)
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
