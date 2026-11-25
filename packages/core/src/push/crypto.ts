export * as PushCrypto from "./crypto.js"

import { createCipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from "node:crypto"
import { Option } from "effect"

export const context = "OpenCode mobile notifications v2"

export interface Agreement {
  readonly serverKey: string
  readonly secret: string
}

/** Works out the key shared with a phone, or nothing when its public key is not a P-256 point. */
export const agree = (server: ECDH, phoneKey: string, id: string): Option.Option<Agreement> => {
  const phone = Buffer.from(phoneKey, "base64")
  if (phone.toString("base64") !== phoneKey) return Option.none()
  if (phone.length !== 65 || phone[0] !== 4) return Option.none()
  return Option.map(computeSecret(server, phone), (shared) => ({
    serverKey: server.getPublicKey("base64"),
    secret: Buffer.from(hkdfSync("sha256", shared, Buffer.from(id, "utf8"), context, 32)).toString("base64"),
  }))
}

// Throws when the bytes are not a point on the curve.
const computeSecret = Option.liftThrowable((server: ECDH, phone: Buffer) => server.computeSecret(phone))

export const newServerKey = () => {
  const server = createECDH("prime256v1")
  server.generateKeys()
  return server
}

/** Encrypts a message for one phone: base64 of nonce, ciphertext and tag. */
export const seal = (secret: string, id: string, plaintext: string, nonce = randomBytes(12)) => {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(secret, "base64"), nonce)
  cipher.setAAD(Buffer.from(`${context}:${id}`, "utf8"))
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString("base64")
}
