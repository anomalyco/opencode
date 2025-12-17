import { describe, expect, test } from "bun:test"
import crypto from "crypto"
import { VaultCrypto } from "../../src/vault/crypto"

describe("VaultCrypto", () => {
  test("encryptJson/decryptJson roundtrip", () => {
    const key = crypto.randomBytes(32)
    const payload = { a: 1, nested: { b: "x" }, arr: [1, 2, 3] }

    const encrypted = VaultCrypto.encryptJson(key, payload)
    const decrypted = VaultCrypto.decryptJson(key, encrypted)

    expect(decrypted).toEqual(payload)
  })

  test("encryptJson uses random nonce", () => {
    const key = crypto.randomBytes(32)
    const payload = { same: true }

    const a = VaultCrypto.encryptJson(key, payload)
    const b = VaultCrypto.encryptJson(key, payload)

    expect(a.nonce_b64).not.toEqual(b.nonce_b64)
  })
})

