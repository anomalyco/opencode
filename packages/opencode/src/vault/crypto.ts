import crypto from "crypto"

export type VaultEncryptedBlob = {
  v: 2
  alg: "AES-256-GCM"
  nonce_b64: string
  tag_b64: string
  data_b64: string
  aad_b64: string
}

export namespace VaultCrypto {
  const NONCE_BYTES = 12
  const KEY_BYTES = 32

  export function encryptJson(key: Buffer, payload: unknown, associatedData: string): VaultEncryptedBlob {
    if (key.length !== KEY_BYTES) {
      throw new Error(`Invalid vault key length. Expected ${KEY_BYTES} bytes, got ${key.length}.`)
    }

    const nonce = crypto.randomBytes(NONCE_BYTES)
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce)

    const aad = Buffer.from(associatedData, "utf8")
    cipher.setAAD(aad)

    const plaintext = Buffer.from(JSON.stringify(payload), "utf8")
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()

    return {
      v: 2,
      alg: "AES-256-GCM",
      nonce_b64: nonce.toString("base64"),
      tag_b64: tag.toString("base64"),
      data_b64: ciphertext.toString("base64"),
      aad_b64: aad.toString("base64"),
    }
  }

  export function decryptJson(key: Buffer, blob: VaultEncryptedBlob, associatedData: string): unknown {
    if (key.length !== KEY_BYTES) {
      throw new Error(`Invalid vault key length. Expected ${KEY_BYTES} bytes, got ${key.length}.`)
    }

    if (blob.v !== 2) throw new Error(`Unsupported vault blob version: ${(blob as any).v}`)
    if (blob.alg !== "AES-256-GCM") throw new Error("Unsupported vault blob format.")

    const nonce = Buffer.from(blob.nonce_b64, "base64")
    const tag = Buffer.from(blob.tag_b64, "base64")
    const data = Buffer.from(blob.data_b64, "base64")
    const aad = Buffer.from(blob.aad_b64, "base64")

    // Verify stored AAD matches expected AAD
    const expectedAad = Buffer.from(associatedData, "utf8")
    if (!aad.equals(expectedAad)) {
      throw new Error("Vault blob AAD mismatch.")
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()])
    return JSON.parse(plaintext.toString("utf8"))
  }
}
