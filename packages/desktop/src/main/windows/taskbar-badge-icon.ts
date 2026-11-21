// Windows 11 critical red disc (#C42B1C) with a white anti-aliased count (1..9, 9+).
const DISC_RED = 0xc4

const DISC_GREEN = 0x2b

const DISC_BLUE = 0x1c

const DIGITS = {
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  3: [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: [".###.", "#....", "####.", "#...#", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  10: [".##.....", "#..#..#.", ".###.###", "...#..#.", ".##....."],
} as const satisfies Record<number, readonly string[]>

function glyphFor(count: number): readonly string[] {
  if (count === 1) return DIGITS[1]

  if (count === 2) return DIGITS[2]

  if (count === 3) return DIGITS[3]

  if (count === 4) return DIGITS[4]

  if (count === 5) return DIGITS[5]

  if (count === 6) return DIGITS[6]

  if (count === 7) return DIGITS[7]

  if (count === 8) return DIGITS[8]

  if (count === 9) return DIGITS[9]

  return DIGITS[10]
}

export type TaskbarBadgeBitmap = {
  readonly width: number
  readonly height: number
  readonly buffer: Buffer
}

/**
 * Renders a square premultiplied-BGRA taskbar overlay badge for `count` (`1..=9`, or `>= 10` as `9+`)
 * at `size` physical pixels, matching `nativeImage.createFromBitmap`.
 */
export function renderTaskbarBadgeBitmap(count: number, size: number): TaskbarBadgeBitmap {
  const clamped = Math.min(Math.max(1, Math.floor(count)), 10)
  const dimension = Math.max(16, Math.round(size))
  const glyph = glyphFor(clamped)
  const rows = glyph.length
  const cols = glyph[0].length
  const glyphHeight = dimension * (clamped >= 10 ? 0.48 : 0.62)
  const cell = glyphHeight / rows
  const glyphWidth = cell * cols
  const originX = (dimension - glyphWidth) / 2
  const originY = (dimension - glyphHeight) / 2
  const radius = dimension / 2
  const buffer = Buffer.alloc(dimension * dimension * 4)

  // 4x4 supersampling produces crisp glyph edges across 16px, 20px, 24px, and 32px DPI sizes.
  const samples = 4
  const step = 1 / samples

  for (let y = 0; y < dimension; y++) {
    for (let x = 0; x < dimension; x++) {
      const dx = x + 0.5 - radius
      const dy = y + 0.5 - radius
      const discAlpha = Math.max(0, Math.min(1, radius - Math.hypot(dx, dy)))

      let hits = 0

      for (let sy = 0; sy < samples; sy++) {
        const py = y + (sy + 0.5) * step
        const row = Math.floor((py - originY) / cell)

        if (row < 0 || row >= rows) continue

        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) * step
          const col = Math.floor((px - originX) / cell)

          if (col >= 0 && col < cols && glyph[row][col] === "#") hits += 1
        }
      }

      const ink = hits / (samples * samples)
      const mix = (channel: number) => Math.round((channel * (1 - ink) + 255 * ink) * discAlpha)
      const offset = (y * dimension + x) * 4

      // NativeImage bitmaps use premultiplied BGRA on Windows.
      buffer[offset] = mix(DISC_BLUE)
      buffer[offset + 1] = mix(DISC_GREEN)
      buffer[offset + 2] = mix(DISC_RED)
      buffer[offset + 3] = Math.round(discAlpha * 255)
    }
  }

  return { width: dimension, height: dimension, buffer }
}
