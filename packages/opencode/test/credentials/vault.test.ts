import { describe, expect, test } from "bun:test"
import crypto from "crypto"
import { VaultCrypto } from "../../src/vault/crypto"

describe("VaultCrypto", () => {
  test("encryptJson/decryptJson roundtrip", () => {
    const key = crypto.randomBytes(32)
    const payload = { a: 1, nested: { b: "x" }, arr: [1, 2, 3] }
    const id = "cred-123"

    const encrypted = VaultCrypto.encryptJson(key, payload, id)
    const decrypted = VaultCrypto.decryptJson(key, encrypted, id)

    expect(decrypted).toEqual(payload)
  })

  test("encryptJson uses random nonce", () => {
    const key = crypto.randomBytes(32)
    const payload = { same: true }
    const id = "cred-123"

    const a = VaultCrypto.encryptJson(key, payload, id)
    const b = VaultCrypto.encryptJson(key, payload, id)

    expect(a.nonce_b64).not.toEqual(b.nonce_b64)
  })

  test("decryptJson fails on AAD mismatch", () => {
    const key = crypto.randomBytes(32)
    const payload = { data: "top-secret" }

    const encrypted = VaultCrypto.encryptJson(key, payload, "cred-original")

    expect(() => {
      // Trying to decrypt with same key but wrong ID (simulating copied file)
      VaultCrypto.decryptJson(key, encrypted, "cred-swapped")
    }).toThrow("Vault blob AAD mismatch")
  })
})
