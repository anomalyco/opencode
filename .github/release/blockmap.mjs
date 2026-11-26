// blockmap.mjs <file>...: writes <file>.blockmap next to each file, the gzipped block map electron-updater fetches
// for a differential download. It matches electron-builder's buildBlockMap (app-builder-lib 26): Rabin
// content-defined chunks of 8-32 KB and a 18-byte BLAKE2b checksum per chunk. electron-builder builds it at pack
// time, but signing changes the installer, so the release builds it here from the final signed files.
//
// It runs in publish jobs that hold secrets, so it uses Node's standard library only.
import { createReadStream, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"

const MIN = 8192
const MAX = 32768
const MASK = 16384 - 1
const WINDOW = 64

// Rabin fingerprint tables for the degree-63 polynomial 0xbfe6b8a5bf378d83 (github.com/aclements/go-rabin), each
// 64-bit entry split into signed 32-bit hi and lo words.
const POLY = 0xbfe6b8a5bf378d83n
const PUSH_HI = new Int32Array(256)
const PUSH_LO = new Int32Array(256)
const POP_HI = new Int32Array(256)
const POP_LO = new Int32Array(256)
{
  const mod = (a) => {
    for (let d = a.toString(2).length - 1; a !== 0n && d >= 63; d = a.toString(2).length - 1)
      a ^= POLY << BigInt(d - 63)
    return a
  }
  const set = (hi, lo, i, x) => {
    hi[i] = Number(BigInt.asIntN(32, x >> 32n))
    lo[i] = Number(BigInt.asIntN(32, x))
  }
  for (let i = 0; i < 256; i++) {
    const b = BigInt(i)
    set(PUSH_HI, PUSH_LO, i, BigInt.asUintN(64, (b << 63n) ^ mod(b << 63n)))
    set(POP_HI, POP_LO, i, mod(b << BigInt((WINDOW - 1) * 8)))
  }
}

// BLAKE2b (RFC 7693) with an 18-byte digest and no key, on 32-bit word pairs. Node's crypto offers only BLAKE2b-512,
// whose digest length is part of the parameter block, so truncating it gives a different hash.
const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a, 0xade682d1,
  0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
])
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
].map((row) => row.map((i) => i * 2))
const ROUNDS = [...SIGMA, SIGMA[0], SIGMA[1]]
const DIGEST = 18
const v = new Uint32Array(32)
const m = new Uint32Array(32)
const h = new Uint32Array(16)
const block = new Uint8Array(128)
const view = new DataView(block.buffer)

function add(a, b0, b1) {
  const lo = v[a] + b0
  v[a + 1] = v[a + 1] + b1 + (lo >= 0x100000000 ? 1 : 0)
  v[a] = lo
}

function mix(a, b, c, d, x, y) {
  add(a, v[b], v[b + 1])
  add(a, m[x], m[x + 1])
  let lo = v[d] ^ v[a]
  let hi = v[d + 1] ^ v[a + 1]
  v[d] = hi
  v[d + 1] = lo
  add(c, v[d], v[d + 1])
  lo = v[b] ^ v[c]
  hi = v[b + 1] ^ v[c + 1]
  v[b] = (lo >>> 24) ^ (hi << 8)
  v[b + 1] = (hi >>> 24) ^ (lo << 8)
  add(a, v[b], v[b + 1])
  add(a, m[y], m[y + 1])
  lo = v[d] ^ v[a]
  hi = v[d + 1] ^ v[a + 1]
  v[d] = (lo >>> 16) ^ (hi << 16)
  v[d + 1] = (hi >>> 16) ^ (lo << 16)
  add(c, v[d], v[d + 1])
  lo = v[b] ^ v[c]
  hi = v[b + 1] ^ v[c + 1]
  v[b] = (hi >>> 31) ^ (lo << 1)
  v[b + 1] = (lo >>> 31) ^ (hi << 1)
}

function compress(count, last) {
  for (let i = 0; i < 16; i++) {
    v[i] = h[i]
    v[i + 16] = IV[i]
  }
  v[24] ^= count
  v[25] ^= Math.floor(count / 0x100000000)
  if (last) {
    v[28] = ~v[28]
    v[29] = ~v[29]
  }
  for (let i = 0; i < 32; i++) m[i] = view.getUint32(i * 4, true)
  for (const s of ROUNDS) {
    mix(0, 8, 16, 24, s[0], s[1])
    mix(2, 10, 18, 26, s[2], s[3])
    mix(4, 12, 20, 28, s[4], s[5])
    mix(6, 14, 22, 30, s[6], s[7])
    mix(0, 10, 20, 30, s[8], s[9])
    mix(2, 12, 22, 24, s[10], s[11])
    mix(4, 14, 16, 26, s[12], s[13])
    mix(6, 8, 18, 28, s[14], s[15])
  }
  for (let i = 0; i < 16; i++) h[i] ^= v[i] ^ v[i + 16]
}

function blake2b(data) {
  h.set(IV)
  h[0] ^= 0x01010000 ^ DIGEST
  let offset = 0
  while (data.length - offset > 128) {
    block.set(data.subarray(offset, offset + 128))
    offset += 128
    compress(offset, false)
  }
  block.fill(0)
  block.set(data.subarray(offset))
  compress(data.length, true)
  return Buffer.from(h.buffer, h.byteOffset, DIGEST).toString("base64")
}

async function blockmap(file) {
  const checksums = []
  const sizes = []
  const chunk = Buffer.allocUnsafe(MAX)
  const win = new Uint8Array(WINDOW)
  let n = 0
  let hi = 0
  let lo = 0
  let pos = 0

  const emit = () => {
    checksums.push(blake2b(chunk.subarray(0, n)))
    sizes.push(n)
    n = hi = lo = pos = 0
    win.fill(0)
  }

  for await (const data of createReadStream(file, { highWaterMark: 256 * 1024 })) {
    for (let i = 0; i < data.length; i++) {
      const b = data[i]
      chunk[n++] = b
      if (n <= MIN - WINDOW) continue
      if (n > MIN) {
        const old = win[pos]
        hi ^= POP_HI[old]
        lo ^= POP_LO[old]
      }
      win[pos] = b
      pos = (pos + 1) % WINDOW
      const top = (hi >>> 23) & 0xff
      const nhi = ((hi << 8) | (lo >>> 24)) & 0x7fffffff
      const nlo = (lo << 8) | b
      hi = nhi ^ PUSH_HI[top]
      lo = nlo ^ PUSH_LO[top]
      if (n >= MIN && ((lo & MASK) === MASK || n >= MAX)) emit()
    }
  }
  if (n > 0) emit()

  const map = { version: "2", files: [{ name: "file", offset: 0, checksums, sizes }] }
  writeFileSync(`${file}.blockmap`, gzipSync(Buffer.from(JSON.stringify(map)), { level: 9 }))
}

for (const file of process.argv.slice(2)) await blockmap(file)
