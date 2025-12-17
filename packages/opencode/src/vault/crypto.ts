import crypto from "crypto"

export type VaultEncryptedBlobV1 = {
  v: 1
  alg: "AES-256-GCM"
  nonce_b64: string
  tag_b64: string
  data_b64: string
}

export namespace VaultCrypto {
  const NONCE_BYTES = 12
  const KEY_BYTES = 32

  export function encryptJson(key: Buffer, payload: unknown): VaultEncryptedBlobV1 {
    if (key.length !== KEY_BYTES) {
      throw new Error(`Invalid vault key length. Expected ${KEY_BYTES} bytes, got ${key.length}.`)
    }

    const nonce = crypto.randomBytes(NONCE_BYTES)
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce)
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8")
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()

    return {
      v: 1,
      alg: "AES-256-GCM",
      nonce_b64: nonce.toString("base64"),
      tag_b64: tag.toString("base64"),
      data_b64: ciphertext.toString("base64"),
    }
  }

  export function decryptJson(key: Buffer, blob: VaultEncryptedBlobV1): unknown {
    if (key.length !== KEY_BYTES) {
      throw new Error(`Invalid vault key length. Expected ${KEY_BYTES} bytes, got ${key.length}.`)
    }
    if (blob.v !== 1 || blob.alg !== "AES-256-GCM") {
      throw new Error("Unsupported vault blob format.")
    }

    const nonce = Buffer.from(blob.nonce_b64, "base64")
    const tag = Buffer.from(blob.tag_b64, "base64")
    const data = Buffer.from(blob.data_b64, "base64")

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()])
    return JSON.parse(plaintext.toString("utf8"))
  }
}

