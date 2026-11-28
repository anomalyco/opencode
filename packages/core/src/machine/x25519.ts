export * as X25519 from "./x25519.js"

// X25519 as RFC 7748 section 5 defines it, in plain JavaScript so it runs the same on every runtime. Cloudflare's
// workerd cannot use an X25519 public key imported from SPKI or JWK in `node:crypto`'s `diffieHellman` ("Failed to
// derive shared diffie-hellman secret"), and Noise only ever has the peer's raw 32 bytes.
//
// The field arithmetic is TweetNaCl's (public domain, https://tweetnacl.cr.yp.to): an element of GF(2^255 - 19) is 16
// signed limbs of 16 bits in a Float64Array. Nothing branches on or indexes by a secret: the ladder swaps with a mask,
// and every loop runs a fixed number of times.

type Field = Float64Array

const field = (limbs: ArrayLike<number> = []) => {
  const out = new Float64Array(16)
  out.set(limbs)
  return out
}

/** (A - 2) / 4 for Curve25519's A = 486662. */
const A24 = field([0xdb41, 1])
/** The u-coordinate of the base point, 9. */
export const BASE = Uint8Array.of(9, ...new Uint8Array(31))

/**
 * RFC 7748 X25519(k, u): the u-coordinate of k times the point at `u`, both 32 bytes little-endian. `k` is clamped
 * and the top bit of `u` is ignored, as the RFC requires. The result is all zeros for a low-order `u`; the caller
 * decides whether that is an error.
 */
export const scalarMult = (k: Uint8Array, u: Uint8Array) => {
  const scalar = new Uint8Array(k.subarray(0, 32))
  scalar[0] &= 248
  scalar[31] = (scalar[31] & 127) | 64
  const x1 = unpack(u)
  const x2 = field([1])
  const z2 = field()
  const x3 = field(x1)
  const z3 = field([1])
  const a = field()
  const aa = field()
  const b = field()
  const bb = field()
  const e = field()
  const c = field()
  const d = field()
  const da = field()
  const cb = field()
  let swap = 0
  for (let t = 254; t >= 0; t--) {
    const bit = (scalar[t >>> 3] >>> (t & 7)) & 1
    swap ^= bit
    select(x2, x3, swap)
    select(z2, z3, swap)
    swap = bit
    add(a, x2, z2)
    square(aa, a)
    sub(b, x2, z2)
    square(bb, b)
    sub(e, aa, bb)
    add(c, x3, z3)
    sub(d, x3, z3)
    mul(da, d, a)
    mul(cb, c, b)
    add(x3, da, cb)
    square(x3, x3)
    sub(z3, da, cb)
    square(z3, z3)
    mul(z3, z3, x1)
    mul(x2, aa, bb)
    mul(z2, A24, e)
    add(z2, z2, aa)
    mul(z2, z2, e)
  }
  select(x2, x3, swap)
  select(z2, z3, swap)
  invert(z2, z2)
  mul(x2, x2, z2)
  return pack(x2)
}

/** Propagates carries so every limb is back under 2^16, folding the top carry into limb 0 as 2^256 = 38. */
const carry = (o: Field) => {
  let c = 1
  for (let i = 0; i < 16; i++) {
    const v = o[i] + c + 65535
    c = Math.floor(v / 65536)
    o[i] = v - c * 65536
  }
  o[0] += c - 1 + 37 * (c - 1)
}

/** Swaps `p` and `q` when `bit` is 1 and leaves them when it is 0, doing the same work either way. */
const select = (p: Field, q: Field, bit: number) => {
  const mask = ~(bit - 1)
  for (let i = 0; i < 16; i++) {
    const t = mask & (p[i] ^ q[i])
    p[i] ^= t
    q[i] ^= t
  }
}

const add = (o: Field, a: Field, b: Field) => {
  for (let i = 0; i < 16; i++) o[i] = a[i] + b[i]
}

const sub = (o: Field, a: Field, b: Field) => {
  for (let i = 0; i < 16; i++) o[i] = a[i] - b[i]
}

const product = new Float64Array(31)

const mul = (o: Field, a: Field, b: Field) => {
  product.fill(0)
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) product[i + j] += a[i] * b[j]
  for (let i = 0; i < 15; i++) product[i] += 38 * product[i + 16]
  for (let i = 0; i < 16; i++) o[i] = product[i]
  carry(o)
  carry(o)
}

const square = (o: Field, a: Field) => mul(o, a, a)

/** a^(p - 2) = 1 / a, by Fermat: p - 2 = 2^255 - 21 has every bit from 254 down set but bits 4 and 2. */
const invert = (o: Field, a: Field) => {
  const c = field(a)
  for (let i = 253; i >= 0; i--) {
    square(c, c)
    if (i !== 2 && i !== 4) mul(c, c, a)
  }
  o.set(c)
}

const unpack = (bytes: Uint8Array) => {
  const o = field()
  for (let i = 0; i < 16; i++) o[i] = bytes[2 * i] + (bytes[2 * i + 1] << 8)
  o[15] &= 0x7fff
  return o
}

/** The canonical 32 bytes of `n`, fully reduced mod p. */
const pack = (n: Field) => {
  const t = field(n)
  const m = field()
  carry(t)
  carry(t)
  carry(t)
  for (let j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed
    for (let i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1)
      m[i - 1] &= 0xffff
    }
    m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1)
    const borrow = (m[15] >> 16) & 1
    m[14] &= 0xffff
    select(t, m, 1 - borrow)
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < 16; i++) {
    out[2 * i] = t[i] & 0xff
    out[2 * i + 1] = t[i] >> 8
  }
  return out
}
