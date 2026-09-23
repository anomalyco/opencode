import { deflateSync } from "node:zlib"

const size = 16
const frameRate = 30
const duration = 1.2
const frameCount = frameRate * duration
const opacity = [0.2, 0.5, 0.75, 1]
// Each digit selects one dot opacity for one of the eight source key poses.
const poses = [
  "0000000000003000031000321",
  "0000000000003000320032100",
  "0000000000333002100010000",
  "3000023000123000000000000",
  "1230001300003000000000000",
  "0012300230003000000000000",
  "0000100022003330000000000",
  "0000000000003330002200001",
].map((pose) => Array.from(pose, (value) => opacity[Number(value)]))
const crcTable = Array.from({ length: 256 }, (_, value) =>
  Array.from({ length: 8 }).reduce<number>((crc) => ((crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1), value),
)

await Bun.write(new URL("../src/v2/components/session-progress-indicator-v2-1x.png", import.meta.url), apng(1))

function apng(scale: number) {
  const frameSize = size * scale
  const header = Buffer.alloc(13)
  header.writeUInt32BE(frameSize, 0)
  header.writeUInt32BE(frameSize, 4)
  header[8] = 8
  header[9] = 6

  const animation = Buffer.alloc(8)
  animation.writeUInt32BE(frameCount, 0)
  animation.writeUInt32BE(0, 4)
  const chunks = [chunk("IHDR", header), chunk("acTL", animation)]
  const sequence = { value: 0 }

  Array.from({ length: frameCount }, (_, frame) => {
    const control = Buffer.alloc(26)
    control.writeUInt32BE(sequence.value++, 0)
    control.writeUInt32BE(frameSize, 4)
    control.writeUInt32BE(frameSize, 8)
    control.writeUInt16BE(1, 20)
    control.writeUInt16BE(frameRate, 22)
    chunks.push(chunk("fcTL", control))

    const data = deflateSync(pixels(scale, frame), { level: 9 })
    if (frame === 0) {
      chunks.push(chunk("IDAT", data))
      return
    }
    const frameData = Buffer.alloc(data.length + 4)
    frameData.writeUInt32BE(sequence.value++, 0)
    data.copy(frameData, 4)
    chunks.push(chunk("fdAT", frameData))
  })

  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks, chunk("IEND", Buffer.alloc(0))])
}

function pixels(scale: number, frame: number) {
  const frameSize = size * scale
  const stride = frameSize * 4 + 1
  const pixels = Buffer.alloc(stride * frameSize)
  const progress = (frame / frameCount) * poses.length
  const current = Math.floor(progress)
  const next = (current + 1) % poses.length
  const mix = easeOut(progress - current)

  Array.from({ length: frameSize }, (_, y) => (pixels[y * stride] = 0))
  poses[current].forEach((value, index) => {
    draw(
      pixels,
      stride,
      (1 + (index % 5) * 3) * scale,
      (1 + Math.floor(index / 5) * 3) * scale,
      3 * scale,
      value + (poses[next][index] - value) * mix,
    )
  })
  return pixels
}

function draw(pixels: Buffer, stride: number, x: number, y: number, size: number, opacity: number) {
  const left = Math.floor(x)
  const top = Math.floor(y)
  const right = Math.ceil(x + size)
  const bottom = Math.ceil(y + size)

  Array.from({ length: bottom - top }, (_, row) => top + row).forEach((py) =>
    Array.from({ length: right - left }, (_, column) => left + column).forEach((px) => {
      const coverageX = Math.max(0, Math.min(px + 1, x + size) - Math.max(px, x))
      const coverageY = Math.max(0, Math.min(py + 1, y + size) - Math.max(py, y))
      const offset = py * stride + 1 + px * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = Math.round(opacity * coverageX * coverageY * 255)
    }),
  )
}

function easeOut(progress: number) {
  const curve = (value: number, first: number, second: number) => {
    const inverse = 1 - value
    return 3 * inverse * inverse * value * first + 3 * inverse * value * value * second + value * value * value
  }
  const parameter = Array.from({ length: 16 }).reduce<[number, number]>(
    (range) => {
      const middle = (range[0] + range[1]) / 2
      return curve(middle, 0, 0.58) < progress ? [middle, range[1]] : [range[0], middle]
    },
    [0, 1],
  )
  return curve((parameter[0] + parameter[1]) / 2, 0, 1)
}

function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type)
  const result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length, 0)
  name.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return result
}

function crc32(data: Buffer) {
  return (
    (data.reduce<number>((crc, value) => crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0
  )
}
