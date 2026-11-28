import { describe, expect, test } from "bun:test"
import { createPrivateKey, createPublicKey, diffieHellman, randomBytes } from "node:crypto"
import { X25519 } from "@opencode/core/machine/x25519.workerd"

const hex = (value: string) => new Uint8Array(Buffer.from(value, "hex"))
const PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex")
const SPKI = Buffer.from("302a300506032b656e032100", "hex")
const privateKey = (key: Uint8Array) =>
  createPrivateKey({ key: Buffer.concat([PKCS8, key]), format: "der", type: "pkcs8" })
const runtimePublicKey = (key: Uint8Array) =>
  new Uint8Array(createPublicKey(privateKey(key)).export({ format: "der", type: "spki" }).subarray(SPKI.length))
const runtimeShared = (key: Uint8Array, u: Uint8Array) =>
  new Uint8Array(
    diffieHellman({
      privateKey: privateKey(key),
      publicKey: createPublicKey({ key: Buffer.concat([SPKI, u]), format: "der", type: "spki" }),
    }),
  )

describe("X25519", () => {
  test("reproduces RFC 7748 section 5.2's vectors", () => {
    expect(
      X25519.scalarMult(
        hex("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4"),
        hex("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c"),
      ),
    ).toEqual(hex("c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552"))
    // The top bit of this u is set, and must be ignored.
    expect(
      X25519.scalarMult(
        hex("4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d"),
        hex("e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493"),
      ),
    ).toEqual(hex("95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957"))
  })

  test("reproduces RFC 7748 section 5.2's iterated vector after 1 and 1000 iterations", () => {
    const iterate = (count: number) => {
      const state = { k: X25519.BASE, u: X25519.BASE }
      for (let i = 0; i < count; i++) {
        const next = X25519.scalarMult(state.k, state.u)
        state.u = state.k
        state.k = next
      }
      return state.k
    }
    expect(iterate(1)).toEqual(hex("422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079"))
    expect(iterate(1000)).toEqual(hex("684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51"))
  })

  test("reproduces RFC 7748 section 6.1's Diffie-Hellman", () => {
    const alice = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
    const bob = hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb")
    const alicePublic = X25519.scalarMult(alice, X25519.BASE)
    const bobPublic = X25519.scalarMult(bob, X25519.BASE)
    expect(alicePublic).toEqual(hex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"))
    expect(bobPublic).toEqual(hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f"))
    const shared = hex("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742")
    expect(X25519.scalarMult(alice, bobPublic)).toEqual(shared)
    expect(X25519.scalarMult(bob, alicePublic)).toEqual(shared)
  })

  test("agrees with this runtime's X25519 on 64 random key pairs and peer keys", () => {
    for (let i = 0; i < 64; i++) {
      const local = new Uint8Array(randomBytes(32))
      const remote = new Uint8Array(randomBytes(32))
      expect(X25519.scalarMult(local, X25519.BASE)).toEqual(runtimePublicKey(local))
      expect(X25519.scalarMult(local, runtimePublicKey(remote))).toEqual(runtimeShared(local, runtimePublicKey(remote)))
      // Arbitrary bytes as u, top bit and non-canonical values included, the way a peer can send them.
      const u = new Uint8Array(randomBytes(32))
      expect(X25519.scalarMult(local, u)).toEqual(runtimeShared(local, u))
    }
  })

  test("gives all zeros for a low-order point", () => {
    for (const point of [
      new Uint8Array(32),
      hex("0100000000000000000000000000000000000000000000000000000000000000"),
      hex("e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800"),
      hex("5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157"),
      hex("ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"),
      hex("edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"),
      hex("eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"),
    ])
      expect(X25519.scalarMult(new Uint8Array(randomBytes(32)), point)).toEqual(new Uint8Array(32))
  })

  test("reads only the first 32 bytes of the scalar and never writes to its inputs", () => {
    const k = new Uint8Array(randomBytes(32))
    const u = runtimePublicKey(new Uint8Array(randomBytes(32)))
    const [kCopy, uCopy] = [k.slice(), u.slice()]
    X25519.scalarMult(k, u)
    expect([k, u]).toEqual([kCopy, uCopy])
  })
})
