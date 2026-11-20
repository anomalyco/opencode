import { prelude } from "./source.js"
import type { JSONSchema } from "./json-schema.js"

export { prelude }

/** The program a client runs: the canonical prelude, a newline, then the template source. */
export function program(source: string) {
  return prelude + "\n" + source
}

/**
 * A template's content address: the first 16 hex chars of sha256(source + "\n" + JSON.stringify(data)). Synchronous so
 * built-in templates are plain values; uses a pure implementation because WebCrypto digests are async only.
 */
export function version(source: string, data: JSONSchema) {
  return sha256(source + "\n" + JSON.stringify(data)).slice(0, 16)
}

/** SHA-256 of the UTF-8 encoding of `text`, as lowercase hex. */
export function sha256(text: string) {
  const bytes = new TextEncoder().encode(text)
  const length = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(length)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(length - 4, bytes.length * 8)
  const hash = Uint32Array.from(INITIAL)
  const w = new Uint32Array(64)
  const v = new Uint32Array(8)
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = w[i - 16] + s0 + w[i - 7] + s1
    }
    v.set(hash)
    for (let i = 0; i < 64; i++) {
      const t1 =
        v[7] + (rotr(v[4], 6) ^ rotr(v[4], 11) ^ rotr(v[4], 25)) + ((v[4] & v[5]) ^ (~v[4] & v[6])) + ROUND[i] + w[i]
      const t2 = (rotr(v[0], 2) ^ rotr(v[0], 13) ^ rotr(v[0], 22)) + ((v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]))
      // Shift a..g into b..h; Uint32Array stores wrap modulo 2^32.
      v.copyWithin(1, 0, 7)
      v[4] += t1
      v[0] = t1 + t2
    }
    for (let i = 0; i < 8; i++) hash[i] += v[i]
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("")
}

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

// The first 32 bits of the fractional parts of the square roots of the first 8 primes and the cube roots of the first
// 64 primes (FIPS 180-4 section 4.2.2 and 5.3.3).
const PRIMES = Array.from({ length: 312 }, (_, n) => n).filter(
  (n) => n > 1 && Array.from({ length: n - 2 }, (_, i) => i + 2).every((d) => n % d !== 0),
)
const INITIAL = PRIMES.slice(0, 8).map((p) => fraction(Math.sqrt(p)))
const ROUND = Uint32Array.from(PRIMES.slice(0, 64).map((p) => fraction(Math.cbrt(p))))

function fraction(x: number) {
  return Math.floor((x - Math.floor(x)) * 0x100000000) >>> 0
}
