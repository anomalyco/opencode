import { describe, expect, it } from "bun:test"
import { PairingStore, generateCode } from "../src/pair"

describe("pairing store", () => {
  it("creates unique codes and ids", () => {
    const store = new PairingStore()
    const a = store.create()
    const b = store.create()
    expect(a.pairId).not.toBe(b.pairId)
    expect(a.code).not.toBe(b.code)
  })

  it("lets a code be claimed exactly once", () => {
    const store = new PairingStore()
    const record = store.create()
    const first = store.claim(record.code)
    expect(first?.pairId).toBe(record.pairId)
    expect(store.claim(record.code)).toBeUndefined()
  })

  it("rejects unknown codes", () => {
    const store = new PairingStore()
    expect(store.claim("AAAA-BBBB")).toBeUndefined()
  })

  it("generates codes from the safe alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateCode()
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
    }
  })
})
