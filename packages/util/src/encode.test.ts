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

  test("hashes the full 4096-char tail for large values", () => {
    const replaceAt = (value: string, index: number) => `${value.slice(0, index)}b${value.slice(index + 1)}`

    const atThreshold = "a".repeat(500_000)
    expect(sampledChecksum(atThreshold)).toBe(checksum(atThreshold))
    expect(sampledChecksum(replaceAt(atThreshold, atThreshold.length - 1))).not.toBe(sampledChecksum(atThreshold))

    for (const length of [500_001, 600_000]) {
      const base = "a".repeat(length)
      const expected = sampledChecksum(base)
      for (const offset of [1, 2048, 4096]) {
        expect(sampledChecksum(replaceAt(base, length - offset))).not.toBe(expected)
      }
    }

    const custom = "a".repeat(10_000)
    const customExpected = sampledChecksum(custom, 8_000)
    expect(sampledChecksum(custom, custom.length)).toBe(checksum(custom))
    for (const offset of [1, 2048, 4096]) {
      expect(sampledChecksum(replaceAt(custom, custom.length - offset), 8_000)).not.toBe(customExpected)
    }
  })
})
