import { createPrivateKey, createPublicKey, diffieHellman } from "node:crypto"

// Native X25519 for Node and Bun (~30us/op). Under the `workerd` bundle condition, `#x25519` resolves to
// `x25519.workerd.ts` because workerd's `node:crypto` cannot run `diffieHellman` on a peer key imported from SPKI/JWK.
const PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex")
const SPKI = Buffer.from("302a300506032b656e032100", "hex")

const privateKeyObject = (key: Uint8Array) =>
  createPrivateKey({ key: Buffer.concat([PKCS8, key]), format: "der", type: "pkcs8" })

export const derivePublicKey = (privateKey: Uint8Array) =>
  new Uint8Array(
    createPublicKey(privateKeyObject(privateKey)).export({ format: "der", type: "spki" }).subarray(SPKI.length),
  )

export const sharedSecret = (privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array | undefined => {
  try {
    return new Uint8Array(
      diffieHellman({
        privateKey: privateKeyObject(privateKey),
        publicKey: createPublicKey({ key: Buffer.concat([SPKI, peerPublicKey]), format: "der", type: "spki" }),
      }),
    )
  } catch {
    return undefined
  }
}
