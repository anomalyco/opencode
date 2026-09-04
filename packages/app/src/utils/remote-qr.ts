const VERSION = 6
const SIZE = 17 + VERSION * 4
const DATA_CODEWORDS = 136
const BLOCK_DATA_CODEWORDS = 68
const ECC_CODEWORDS = 18
const MAX_BYTE_PAYLOAD = 134
const REMAINDER_BITS = 7

export function encodeRemoteQr(value: string) {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length > MAX_BYTE_PAYLOAD) throw new Error("remote_qr_payload_too_long")

  const data = encodeData(bytes)
  const divisor = reedSolomonDivisor(ECC_CODEWORDS)
  const blocks = [data.slice(0, BLOCK_DATA_CODEWORDS), data.slice(BLOCK_DATA_CODEWORDS)]
  const ecc = blocks.map((block) => reedSolomonRemainder(block, divisor))
  const codewords: number[] = []

  for (let i = 0; i < BLOCK_DATA_CODEWORDS; i++) {
    codewords.push(blocks[0]![i]!, blocks[1]![i]!)
  }
  for (let i = 0; i < ECC_CODEWORDS; i++) {
    codewords.push(ecc[0]![i]!, ecc[1]![i]!)
  }

  const dataBits = codewords.flatMap((byte) => byteBits(byte))
  dataBits.push(...Array(REMAINDER_BITS).fill(0))

  const modules = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false))
  const functionModules = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false))

  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    modules[y]![x] = dark
    functionModules[y]![x] = true
  }

  for (let i = 0; i < SIZE; i++) {
    setFunction(6, i, i % 2 === 0)
    setFunction(i, 6, i % 2 === 0)
  }

  drawFinder(setFunction, 3, 3)
  drawFinder(setFunction, SIZE - 4, 3)
  drawFinder(setFunction, 3, SIZE - 4)
  drawAlignment(setFunction, 34, 34)
  drawFormat(setFunction, 0)

  let bitIndex = 0
  let upward = true
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1
    for (let vertical = 0; vertical < SIZE; vertical++) {
      const y = upward ? SIZE - 1 - vertical : vertical
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset
        if (functionModules[y]![x]) continue
        let bit = dataBits[bitIndex++] ?? 0
        if ((x + y) % 2 === 0) bit ^= 1
        modules[y]![x] = bit !== 0
      }
    }
    upward = !upward
  }

  if (bitIndex !== dataBits.length) throw new Error("remote_qr_layout_mismatch")
  return modules
}

export function remoteQrPath(modules: boolean[][], quietZone = 4) {
  const path: string[] = []
  for (let y = 0; y < modules.length; y++) {
    const row = modules[y]!
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      path.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`)
    }
  }
  return path.join("")
}

export const REMOTE_QR_SIZE = SIZE
export const REMOTE_QR_QUIET_ZONE = 4

function encodeData(bytes: Uint8Array) {
  const bits: number[] = []
  appendBits(bits, 0b0100, 4)
  appendBits(bits, bytes.length, 8)
  for (const byte of bytes) appendBits(bits, byte, 8)

  const capacity = DATA_CODEWORDS * 8
  const terminator = Math.min(4, capacity - bits.length)
  bits.push(...Array(Math.max(0, terminator)).fill(0))
  while (bits.length % 8 !== 0) bits.push(0)

  const result: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j]!
    result.push(value)
  }

  for (let pad = 0; result.length < DATA_CODEWORDS; pad++) result.push(pad % 2 === 0 ? 0xec : 0x11)
  return result
}

function appendBits(target: number[], value: number, count: number) {
  for (let i = count - 1; i >= 0; i--) target.push((value >>> i) & 1)
}

function byteBits(value: number) {
  return Array.from({ length: 8 }, (_, i) => (value >>> (7 - i)) & 1)
}

function drawFinder(setFunction: (x: number, y: number, dark: boolean) => void, centerX: number, centerY: number) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      setFunction(centerX + dx, centerY + dy, distance !== 2 && distance !== 4)
    }
  }
}

function drawAlignment(
  setFunction: (x: number, y: number, dark: boolean) => void,
  centerX: number,
  centerY: number,
) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
}

function drawFormat(setFunction: (x: number, y: number, dark: boolean) => void, mask: number) {
  const data = (1 << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  const bits = ((data << 10) | remainder) ^ 0x5412
  const dark = (index: number) => ((bits >>> index) & 1) !== 0

  for (let i = 0; i <= 5; i++) setFunction(8, i, dark(i))
  setFunction(8, 7, dark(6))
  setFunction(8, 8, dark(7))
  setFunction(7, 8, dark(8))
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, dark(i))

  for (let i = 0; i < 8; i++) setFunction(SIZE - 1 - i, 8, dark(i))
  for (let i = 8; i < 15; i++) setFunction(8, SIZE - 15 + i, dark(i))
  setFunction(8, SIZE - 8, true)
}

function reedSolomonDivisor(degree: number) {
  const result = new Uint8Array(degree)
  result[degree - 1] = 1
  let root = 1

  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = finiteFieldMultiply(result[j]!, root)
      if (j + 1 < degree) result[j] ^= result[j + 1]!
    }
    root = finiteFieldMultiply(root, 0x02)
  }
  return result
}

function reedSolomonRemainder(data: number[], divisor: Uint8Array) {
  const result = new Uint8Array(divisor.length)
  for (const byte of data) {
    const factor = byte ^ result[0]!
    result.copyWithin(0, 1)
    result[result.length - 1] = 0
    for (let i = 0; i < divisor.length; i++) result[i] ^= finiteFieldMultiply(divisor[i]!, factor)
  }
  return result
}

function finiteFieldMultiply(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    if (((y >>> i) & 1) !== 0) z ^= x
  }
  return z & 0xff
}
