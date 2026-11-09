// QR Code encoder (ISO/IEC 18004) for byte-mode text at error correction level L, following the structure of
// Project Nayuki's QR Code generator (MIT): https://www.nayuki.io/page/qr-code-generator-library

// Error correction codewords per block and block count at level L, for versions 1 to 40.
const ECC_PER_BLOCK = [
  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30,
  30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
]
const BLOCKS = [
  1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19,
  20, 21, 22, 24, 25,
]

const MASKS = [
  (x: number, y: number) => (x + y) % 2 === 0,
  (_: number, y: number) => y % 2 === 0,
  (x: number) => x % 3 === 0,
  (x: number, y: number) => (x + y) % 3 === 0,
  (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

type Draw = (x: number, y: number, dark: boolean) => void

/** Encodes text as UTF-8 into the smallest QR Code that fits. Rows of modules without a quiet zone; true is dark. */
export function encode(text: string) {
  const bytes = new TextEncoder().encode(text)
  const version = Array.from({ length: 40 }, (_, i) => i + 1).find(
    (v) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCapacity(v) * 8,
  )
  if (version === undefined) throw new RangeError(`Text is too long for a QR Code: ${bytes.length} bytes`)

  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  drawFunctionPatterns(version, size, (x, y, dark) => {
    modules[y][x] = dark
    reserved[y][x] = true
  })
  drawCodewords(modules, reserved, addErrorCorrection(dataCodewords(bytes, version), version))

  const candidates = MASKS.map((mask, index) => {
    const masked = modules.map((row, y) => row.map((dark, x) => dark !== (!reserved[y][x] && mask(x, y))))
    drawFormat(index, size, (x, y, dark) => {
      masked[y][x] = dark
    })
    return masked
  })
  const scores = candidates.map(penalty)
  return candidates[scores.indexOf(Math.min(...scores))]
}

/** Renders text as an SVG QR Code with 10-unit modules and a quiet zone of `border` modules. */
export function renderSVG(text: string, options: { border?: number; blackColor?: string; whiteColor?: string } = {}) {
  const modules = addBorder(encode(text), options.border ?? 1)
  const width = modules.length * 10
  const path = modules
    .flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x * 10},${y * 10}h10v10h-10z`] : [])))
    .join("")
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}">` +
    `<rect fill="${escapeAttribute(options.whiteColor ?? "white")}" width="${width}" height="${width}"/>` +
    `<path fill="${escapeAttribute(options.blackColor ?? "black")}" d="${path}"/></svg>`
  )
}

/**
 * Renders text as a QR Code for a terminal, two modules per character with half blocks. Light modules draw as blocks
 * and dark modules as the terminal background, rows are joined with "\n", and the quiet zone is `border` modules.
 */
export function renderUnicodeCompact(text: string, options: { border?: number } = {}) {
  const modules = addBorder(encode(text), options.border ?? 1)
  return Array.from({ length: Math.ceil(modules.length / 2) }, (_, line) =>
    modules[line * 2]
      .map((top, x) => {
        // The symbol has an odd number of rows, so the last line's missing bottom half shows the terminal background.
        const bottom = modules[line * 2 + 1]?.[x] ?? true
        if (top) return bottom ? " " : "\u2584"
        return bottom ? "\u2580" : "\u2588"
      })
      .join(""),
  ).join("\n")
}

function drawFunctionPatterns(version: number, size: number, set: Draw) {
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4)
      }

  const positions = alignmentPositions(version, size)
  const last = positions.length - 1
  positions.forEach((cx, i) =>
    positions.forEach((cy, j) => {
      // Skip the three corners that hold finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }),
  )

  // Reserves the format areas; the real format bits are drawn once the mask is chosen.
  drawFormat(0, size, set)
  if (version < 7) return
  const bits = bch(version, 12, 0x1f25)
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    const dark = ((bits >>> i) & 1) === 1
    set(a, b, dark)
    set(b, a, dark)
  }
}

function alignmentPositions(version: number, size: number) {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  return [6, ...Array.from({ length: count - 1 }, (_, i) => size - 7 - (count - 2 - i) * step)]
}

function drawFormat(mask: number, size: number, set: Draw) {
  // Level L is 0b01 in the format information.
  const bits = bch((1 << 3) | mask, 10, 0x537) ^ 0x5412
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6))
  set(8, 8, bit(7))
  set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true)
}

// Appends the BCH remainder of `data` for a generator polynomial of the given degree.
function bch(data: number, degree: number, generator: number) {
  let remainder = data
  for (let i = 0; i < degree; i++) remainder = (remainder << 1) ^ ((remainder >>> (degree - 1)) * generator)
  return (data << degree) | remainder
}

function dataCodewords(bytes: Uint8Array, version: number) {
  const capacity = dataCapacity(version)
  const bits: number[] = []
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  append(0b0100, 4)
  append(bytes.length, version < 10 ? 8 : 16)
  bytes.forEach((byte) => append(byte, 8))
  append(0, Math.min(4, capacity * 8 - bits.length))
  append(0, (8 - (bits.length % 8)) % 8)
  const data = Array.from({ length: bits.length / 8 }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0),
  )
  return [...data, ...Array.from({ length: capacity - data.length }, (_, i) => (i % 2 === 0 ? 0xec : 0x11))]
}

function addErrorCorrection(data: number[], version: number) {
  const blocks = BLOCKS[version - 1]
  const ecc = ECC_PER_BLOCK[version - 1]
  const raw = Math.floor(rawModules(version) / 8)
  // The first `short` blocks hold one data codeword fewer than the rest.
  const short = blocks - (raw % blocks)
  const shortLength = Math.floor(raw / blocks) - ecc
  const divisor = reedSolomonDivisor(ecc)
  const split = Array.from({ length: blocks }, (_, i) => {
    const start = i * shortLength + Math.max(0, i - short)
    return data.slice(start, start + shortLength + (i < short ? 0 : 1))
  })
  const interleave = (rows: number[][], length: number) =>
    Array.from({ length }, (_, i) => rows.flatMap((row) => (i < row.length ? [row[i]] : []))).flat()
  return [
    ...interleave(split, shortLength + 1),
    ...interleave(
      split.map((block) => reedSolomonRemainder(block, divisor)),
      ecc,
    ),
  ]
}

function drawCodewords(modules: boolean[][], reserved: boolean[][], codewords: number[]) {
  const size = modules.length
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing pattern takes column 6, so the column pair shifts left past it.
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical
        if (reserved[y][x] || i >= codewords.length * 8) continue
        modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
        i++
      }
  }
}

function penalty(modules: boolean[][]) {
  const size = modules.length
  const columns = modules.map((_, x) => modules.map((row) => row[x]))
  const lines = [...modules, ...columns].reduce((sum, line) => sum + linePenalty(line), 0)
  // Each 2x2 block of one colour, found from its bottom-right module.
  const boxes = modules
    .slice(1)
    .flatMap((row, y) =>
      row.slice(1).filter((dark, x) => dark === row[x] && dark === modules[y][x] && dark === modules[y][x + 1]),
    ).length
  const dark = modules.flat().filter(Boolean).length
  const total = size * size
  return lines + boxes * 3 + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
}

// Scores runs of five or more same-coloured modules, and 1:1:3:1:1 finder-like patterns with 4 light modules on a side.
function linePenalty(line: boolean[]) {
  const size = line.length
  const history = [0, 0, 0, 0, 0, 0, 0]
  const push = (length: number) => {
    history.pop()
    history.unshift(history[0] === 0 ? length + size : length)
  }
  const finders = () => {
    const n = history[1]
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n
    return (
      (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
      (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    )
  }
  let result = 0
  let color = false
  let run = 0
  for (const dark of line) {
    if (dark === color) {
      run++
      if (run === 5) result += 3
      if (run > 5) result++
      continue
    }
    push(run)
    if (!color) result += finders() * 40
    color = dark
    run = 1
  }
  if (color) {
    push(run)
    run = 0
  }
  push(run + size)
  return result + finders() * 40
}

function reedSolomonDivisor(degree: number) {
  const result = Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = multiply(root, 2)
  }
  return result
}

function reedSolomonRemainder(data: number[], divisor: number[]) {
  return data.reduce(
    (remainder, byte) => {
      const factor = byte ^ remainder[0]
      return [...remainder.slice(1), 0].map((value, i) => value ^ multiply(divisor[i], factor))
    },
    divisor.map(() => 0),
  )
}

// Multiplies in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1.
function multiply(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rawModules(version: number) {
  const base = (16 * version + 128) * version + 64
  if (version < 2) return base
  const count = Math.floor(version / 7) + 2
  return base - ((25 * count - 10) * count - 55) - (version >= 7 ? 36 : 0)
}

function dataCapacity(version: number) {
  return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version - 1] * BLOCKS[version - 1]
}

function addBorder(modules: boolean[][], border: number) {
  const width = modules.length + border * 2
  const blank = () => Array<boolean>(width).fill(false)
  const edge = Array.from({ length: border }, blank)
  const padding = Array<boolean>(border).fill(false)
  return [...edge, ...modules.map((row) => [...padding, ...row, ...padding]), ...Array.from({ length: border }, blank)]
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
