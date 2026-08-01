import { describe, expect, test } from "bun:test"
import { marketplaceDigest, marketplaceSha256, stableMarketplaceValue } from "../src/marketplace-digest"

describe("marketplace digest", () => {
  test("matches standard SHA-256 vectors", () => {
    expect(marketplaceSha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    expect(marketplaceSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  test("canonicalizes object key order and omits undefined", () => {
    expect(stableMarketplaceValue({ b: 2, a: 1, ignored: undefined })).toBe('{"a":1,"b":2}')
    expect(marketplaceDigest({ b: 2, a: 1 })).toBe(marketplaceDigest({ a: 1, b: 2 }))
  })
})
