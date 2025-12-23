import { Transformer } from "@napi-rs/image"

/**
 * Shared test image generator to avoid creating images repeatedly in tests
 * Images are cached after first generation
 */

interface TestImage {
  buffer: Buffer
  size: number
  width: number
  height: number
  base64: string
}

const cache: { large: TestImage | null; small: TestImage | null } = { large: null, small: null }

/** Create a BMP buffer with pseudo-random pixels for testing */
function createBmpBuffer(width: number, height: number, seed: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelDataSize = rowSize * height
  const buffer = Buffer.alloc(54 + pixelDataSize)

  // BMP header
  buffer.write("BM", 0)
  buffer.writeUInt32LE(54 + pixelDataSize, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(pixelDataSize, 34)

  // Fill with pseudo-random pixels (LCG PRNG for reproducibility)
  const prng = { state: seed }
  for (let i = 54; i < buffer.length; i++) {
    prng.state = (prng.state * 1103515245 + 12345) & 0x7fffffff
    buffer[i] = prng.state % 256
  }

  return buffer
}

/**
 * Generate a large PNG image (~6MB) that needs compression
 * Cached after first generation to avoid recreating it
 */
export async function getLargeTestImage(): Promise<TestImage> {
  if (cache.large) return cache.large

  const width = 4500
  const height = 4500
  const bmpBuffer = createBmpBuffer(width, height, 12345)
  const pngBuffer = await new Transformer(bmpBuffer).png()

  cache.large = {
    buffer: pngBuffer,
    size: pngBuffer.length,
    width,
    height,
    base64: pngBuffer.toString("base64"),
  }

  return cache.large
}

/**
 * Generate a small PNG image (~500KB) that doesn't need compression
 * Cached after first generation
 */
export async function getSmallTestImage(): Promise<TestImage> {
  if (cache.small) return cache.small

  const width = 800
  const height = 600
  const bmpBuffer = createBmpBuffer(width, height, 54321)
  const pngBuffer = await new Transformer(bmpBuffer).png()

  cache.small = {
    buffer: pngBuffer,
    size: pngBuffer.length,
    width,
    height,
    base64: pngBuffer.toString("base64"),
  }

  return cache.small
}

/**
 * Reset cached images (useful between test suites)
 */
export function clearImageCache() {
  cache.large = null
  cache.small = null
}
