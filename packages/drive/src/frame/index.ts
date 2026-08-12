/**
 * Renderer-neutral vocabulary for drawing captured terminal frames: the
 * canonical cell geometry, OpenTUI text-attribute bits, geometric block/bar
 * glyph primitives, and baseline placement. Both the Drive PNG renderer
 * (`recording/render.ts`) and browser canvas renderers consume this module so
 * their output stays synchronized by construction.
 *
 * This entry point must stay dependency-free and browser-safe.
 */

/** OpenTUI text-attribute bits carried on captured spans. */
export const TextStyle = {
  bold: 1,
  dim: 2,
  italic: 4,
  underline: 8,
  blink: 16,
  inverse: 32,
  invisible: 64,
  strikethrough: 128,
} as const

/** Canonical cell width in pixels. */
export const CellWidth = 10
/** Canonical cell height in pixels. */
export const CellHeight = 20
/** Canonical font size in pixels for cell text. */
export const FontSize = 16
/** Opacity applied to dim spans. */
export const DimAlpha = 0.55
/** Y offset of the underline stroke within a cell. */
export const UnderlineOffset = 17
/** Y offset of the strikethrough stroke within a cell. */
export const StrikethroughOffset = 10

/** A rectangle in pixels relative to a cell's top-left corner. */
export interface GlyphRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Whether the rectangle's width scales with the glyph's cell count. */
  readonly stretch: boolean
}

/**
 * Terminal cell primitives that renderers draw geometrically instead of with
 * fonts: solid blocks and structural bars. Ordinary Unicode symbols belong in
 * fallback fonts, not in this table.
 */
export const BlockGlyphs: Record<string, GlyphRect> = {
  "█": { x: 0, y: 0, width: CellWidth, height: CellHeight, stretch: true },
  "▀": { x: 0, y: 0, width: CellWidth, height: CellHeight / 2, stretch: true },
  "▄": {
    x: 0,
    y: CellHeight / 2,
    width: CellWidth,
    height: CellHeight / 2,
    stretch: true,
  },
  "┃": { x: CellWidth / 2 - 1, y: 0, width: 2, height: CellHeight, stretch: false },
  "╹": { x: CellWidth / 2 - 1, y: 0, width: 2, height: CellHeight / 2, stretch: false },
}

const lightBoxGlyphs: Record<
  string,
  readonly [up: boolean, right: boolean, down: boolean, left: boolean]
> = {
  "─": [false, true, false, true],
  "│": [true, false, true, false],
  "┌": [false, true, true, false],
  "┐": [false, false, true, true],
  "└": [true, true, false, false],
  "┘": [true, false, false, true],
  "├": [true, true, true, false],
  "┤": [true, false, true, true],
  "┬": [false, true, true, true],
  "┴": [true, true, false, true],
  "┼": [true, true, true, true],
  "╭": [false, true, true, false],
  "╮": [false, false, true, true],
  "╰": [true, true, false, false],
  "╯": [true, false, false, true],
}

const diagonalBlockGlyphs: Record<string, ReadonlyArray<Omit<GlyphRect, "stretch">>> = {
  "▚": [
    { x: 0, y: 0, width: CellWidth / 2, height: CellHeight / 2 },
    { x: CellWidth / 2, y: CellHeight / 2, width: CellWidth / 2, height: CellHeight / 2 },
  ],
  "▞": [
    { x: CellWidth / 2, y: 0, width: CellWidth / 2, height: CellHeight / 2 },
    { x: 0, y: CellHeight / 2, width: CellWidth / 2, height: CellHeight / 2 },
  ],
}

/**
 * Draws a block/bar glyph geometrically. Returns false when the character is
 * not a geometric primitive and must be drawn with fonts instead.
 */
export const drawBlockGlyph = (
  context: {
    fillRect(x: number, y: number, width: number, height: number): void
  },
  char: string,
  x: number,
  y: number,
  cells = 1,
): boolean => {
  const glyph = BlockGlyphs[char]
  if (glyph !== undefined) {
    const width = glyph.stretch
      ? glyph.width + (cells - 1) * CellWidth
      : glyph.width
    context.fillRect(x + glyph.x, y + glyph.y, width, glyph.height)
    return true
  }
  const box = lightBoxGlyphs[char]
  if (box !== undefined) {
    const lineX = CellWidth / 2 - 1
    const lineY = CellHeight / 2 - 1
    const vertical = box[0] || box[2]
    if (vertical) {
      const top = box[0] ? 0 : lineY
      const bottom = box[2] ? CellHeight : lineY + 1
      context.fillRect(x + lineX, y + top, 1, bottom - top)
    }
    if (!vertical && (box[1] || box[3])) {
      const left = box[3] ? 0 : lineX
      const right = box[1] ? CellWidth : lineX + 1
      context.fillRect(x + left, y + lineY, right - left, 1)
    } else {
      if (box[3]) context.fillRect(x, y + lineY, lineX, 1)
      if (box[1]) context.fillRect(x + lineX + 1, y + lineY, CellWidth - lineX - 1, 1)
    }
    return true
  }
  const quadrants = diagonalBlockGlyphs[char]
  if (quadrants === undefined) return false
  for (const quadrant of quadrants)
    context.fillRect(x + quadrant.x, y + quadrant.y, quadrant.width, quadrant.height)
  return true
}

/** The subset of a canvas 2D context needed to measure font baselines. */
export interface FontMeasurer {
  measureText(text: string): {
    readonly fontBoundingBoxAscent?: number
    readonly fontBoundingBoxDescent?: number
  }
}

const baselineCache = new Map<string, number>()

/**
 * Alphabetic baseline that centers the font's bounding box in a cell. The
 * context's font must already be set to `font`.
 */
export const baselineOffset = (context: FontMeasurer, font: string): number => {
  const cached = baselineCache.get(font)
  if (cached !== undefined) return cached
  const metrics = context.measureText("Mg")
  const ascent = metrics.fontBoundingBoxAscent ?? FontSize * 0.8
  const descent = metrics.fontBoundingBoxDescent ?? FontSize * 0.2
  const offset = (CellHeight - (ascent + descent)) / 2 + ascent
  baselineCache.set(font, offset)
  return offset
}
