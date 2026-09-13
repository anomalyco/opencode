import bidiFactory from "bidi-js"

// Unicode Bidirectional Algorithm (UAX #9) engine. bidi-js is a pure-JS
// implementation verified against the Unicode bidi conformance suite. All
// reordering below is derived from resolved embedding levels, never from
// naive string reversal.
const bidi = bidiFactory()

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

// Directional isolates used for layout only. They mark embedded LTR content
// (paths, URLs, code spans, numbers) inside RTL paragraphs so surrounding
// neutrals cannot leak into the wrong run. They are never painted and never
// stored in any buffer, so copy/paste and logical text stay untouched.
const LRI = "\u2066"
const PDI = "\u2069"

// Strong RTL coverage: Hebrew, Arabic, Syriac, Thaana, NKO, Samaritan,
// Mandaic, extensions, presentation forms, RLM/ALM/RLE/RLO.
const RTL_PROBE =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0860-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u200F\u202B\u061C]/

export function hasRtl(text: string) {
  return RTL_PROBE.test(text)
}

// LTR islands embedded in RTL text, matched on logical text and wrapped in
// LRI/PDI during layout. Bare English words are deliberately not isolated:
// UAX #9 already renders them as LTR runs and they must stay in natural bidi
// flow with the surrounding sentence.
const LTR_ISLAND =
  /(?:https?:\/\/|www\.)\S+|[A-Za-z0-9_@]+(?:[/\\.-][A-Za-z0-9_@-]+)+|\d+(?:[.,:/]\d+)*%?/g

export type BidiGlyph = {
  char: string
  // Terminal cell width. Newlines count as one offset position to match the
  // textarea width-offset convention.
  width: number
  // Char index of the glyph within the source string.
  charIndex: number
  newline: boolean
  // Isolate control glyph: participates in the bidi computation only.
  control: boolean
}

export type BidiCell = {
  // Display text; mirrored brackets already substituted for RTL runs.
  char: string
  width: number
  // Global glyph index in the logical stream (never a control glyph).
  glyph: number
  // Visual column where the cell starts on its line.
  col: number
  // True when the cell belongs to an odd (RTL) embedding level.
  rtl: boolean
}

export type BidiLine = {
  // Cells in left-to-right paint order.
  cells: BidiCell[]
  // Painted width excluding edge whitespace.
  width: number
  // Paragraph base direction; RTL lines align to the right edge.
  rtl: boolean
  // Global glyph range of the line, edge whitespace excluded.
  start: number
  end: number
  // Local logical boundary (0..end-start) -> visual column on the line.
  boundaryCols: number[]
  // Local logical boundary (0..end-start) -> cumulative logical width.
  logicalWidths: number[]
}

export type BidiParagraph = {
  // Glyph range of the paragraph excluding its terminating newline glyph.
  start: number
  end: number
  // Visual line range within layout.lines.
  firstLine: number
  lineCount: number
  // Cumulative logical width at the paragraph start boundary.
  startWidth: number
}

export type BidiLayout = {
  glyphs: BidiGlyph[]
  lines: BidiLine[]
  paragraphs: BidiParagraph[]
  // Global boundary -> visual line index.
  boundaryLine: Int32Array
  // Global boundary -> cumulative logical width offset (newline = 1).
  boundaryWidths: Float64Array
  // Global boundary -> paragraph index.
  boundaryParagraph: Int32Array
}

// Caller-provided isolate ranges in char-index space of the source string.
export type BidiIsolateRange = [number, number]

const WHITESPACE = /\s/

function glyphWidth(char: string) {
  if (char === "\n") return 1
  return Bun.stringWidth(char)
}

// Greedy word wrapping mirroring the native text-buffer policy: break after
// whitespace when possible, hard-break a run that cannot fit, and never split
// a grapheme.
function wrapGlyphs(glyphs: BidiGlyph[], start: number, end: number, maxWidth: number) {
  const ranges: Array<[number, number]> = []
  const limit = maxWidth > 0 ? maxWidth : Number.POSITIVE_INFINITY
  let lineStart = start
  let width = 0
  let breakAt = -1
  for (let i = start; i < end; i++) {
    const glyph = glyphs[i]
    if (glyph.newline) {
      ranges.push([lineStart, i])
      lineStart = i + 1
      width = 0
      breakAt = -1
      continue
    }
    if (width + glyph.width > limit && i > lineStart) {
      if (breakAt > lineStart) {
        ranges.push([lineStart, breakAt])
        lineStart = breakAt
      } else {
        ranges.push([lineStart, i])
        lineStart = i
      }
      width = 0
      for (let j = lineStart; j < i; j++) width += glyphs[j].width
      breakAt = -1
      for (let j = lineStart; j < i; j++) {
        if (WHITESPACE.test(glyphs[j].char)) breakAt = j + 1
      }
    }
    width += glyph.width
    if (WHITESPACE.test(glyph.char)) breakAt = i + 1
  }
  ranges.push([lineStart, end])
  return ranges
}

function trimEdgeWhitespace(glyphs: BidiGlyph[], start: number, end: number) {
  while (
    start < end &&
    !glyphs[start].newline &&
    !glyphs[start].control &&
    WHITESPACE.test(glyphs[start].char)
  ) {
    start++
  }
  while (
    end > start &&
    !glyphs[end - 1].newline &&
    !glyphs[end - 1].control &&
    WHITESPACE.test(glyphs[end - 1].char)
  ) {
    end--
  }
  return [start, end] as const
}

// Converts a UTF-16 code-unit index into a glyph index using the glyph
// start-offset table; bidi-js works in code units while layout works in
// graphemes.
function unitToGlyph(starts: Uint32Array, unit: number) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= unit) lo = mid
    else hi = mid - 1
  }
  return lo
}

function mergeRanges(ranges: Array<[number, number]>) {
  if (ranges.length === 0) return [] as Array<[number, number]>
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]]
  for (const [from, to] of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (from <= last[1] + 1) {
      last[1] = Math.max(last[1], to)
      continue
    }
    merged.push([from, to])
  }
  return merged
}

export function layoutBidiText(text: string, maxWidth: number, isolateRanges: BidiIsolateRange[] = []): BidiLayout {
  // Global logical glyph stream. Boundaries sit between glyphs; boundary g is
  // "before glyph g" and the final boundary equals glyphs.length.
  const glyphs: BidiGlyph[] = []
  const charToGlyph = new Map<number, number>()
  for (const part of graphemes.segment(text)) {
    charToGlyph.set(part.index, glyphs.length)
    glyphs.push({
      char: part.segment,
      width: glyphWidth(part.segment),
      charIndex: part.index,
      newline: part.segment === "\n",
      control: false,
    })
  }

  const boundaryWidths = new Float64Array(glyphs.length + 1)
  {
    let width = 0
    for (let i = 0; i < glyphs.length; i++) {
      boundaryWidths[i] = width
      width += glyphs[i].width
    }
    boundaryWidths[glyphs.length] = width
  }

  const lines: BidiLine[] = []
  const paragraphs: BidiParagraph[] = []
  const boundaryLine = new Int32Array(glyphs.length + 1).fill(-1)
  const boundaryParagraph = new Int32Array(glyphs.length + 1).fill(-1)

  const registerLine = (line: BidiLine) => {
    lines.push(line)
    const lineIndex = lines.length - 1
    for (let g = line.start; g <= line.end; g++) {
      if (boundaryLine[g] === -1 || g === line.end) boundaryLine[g] = lineIndex
      if (boundaryParagraph[g] === -1) boundaryParagraph[g] = paragraphs.length
    }
  }

  const layoutParagraph = (paraStart: number, paraEnd: number) => {
    const firstLine = lines.length
    const baseChar = glyphs[paraStart]?.charIndex ?? text.length
    const endChar = glyphs[paraEnd]?.charIndex ?? text.length
    const paraText = text.slice(baseChar, endChar)
    const rtlParagraph = hasRtl(paraText)

    // LTR islands: caller-provided ranges plus regex detection, all converted
    // to glyph indices and merged so isolates never nest.
    const detected: Array<[number, number]> = []
    if (rtlParagraph) {
      LTR_ISLAND.lastIndex = 0
      let match = LTR_ISLAND.exec(paraText)
      while (match) {
        const from = charToGlyph.get(baseChar + match.index)
        const to = charToGlyph.get(baseChar + match.index + match[0].length - 1)
        if (from !== undefined && to !== undefined && to >= from) detected.push([from, to])
        match = LTR_ISLAND.exec(paraText)
      }
    }
    const callerRanges = isolateRanges.flatMap(([from, to]) => {
      let first = -1
      let last = -1
      for (let unit = from; unit <= Math.min(to, text.length - 1); unit++) {
        const glyph = charToGlyph.get(unit)
        if (glyph === undefined || glyphs[glyph].newline) continue
        if (first === -1) first = glyph
        last = glyph
      }
      return first === -1 || first < paraStart || last >= paraEnd ? [] : [[first, last] as [number, number]]
    })
    const islands = mergeRanges([...callerRanges, ...detected])

    // Augmented glyph stream with LRI/PDI around islands. Control glyphs are
    // zero width and map back to -1 in the logical stream.
    const augmented: BidiGlyph[] = []
    const augmentedToLogical: number[] = []
    let islandCursor = 0
    for (let i = paraStart; i < paraEnd; i++) {
      while (islandCursor < islands.length && islands[islandCursor][1] < i) islandCursor++
      const island = islands[islandCursor]
      if (island && i === island[0]) {
        augmented.push({ char: LRI, width: 0, charIndex: -1, newline: false, control: true })
        augmentedToLogical.push(-1)
      }
      augmented.push(glyphs[i])
      augmentedToLogical.push(i)
      if (island && i === island[1]) {
        augmented.push({ char: PDI, width: 0, charIndex: -1, newline: false, control: true })
        augmentedToLogical.push(-1)
      }
    }

    // Code-unit offsets for every augmented glyph (bidi-js works per unit).
    const starts = new Uint32Array(augmented.length)
    {
      let unit = 0
      for (let i = 0; i < augmented.length; i++) {
        starts[i] = unit
        unit += augmented[i].char.length
      }
    }
    const augmentedText = augmented.map((g) => g.char).join("")

    // Resolve embedding levels; the paragraph direction follows UAX #9 P2/P3
    // (first strong character, honoring isolates).
    const embedding = rtlParagraph ? bidi.getEmbeddingLevels(augmentedText, "auto") : undefined
    const levels = embedding ? embedding.levels : new Uint8Array(augmentedText.length)
    const rtl = embedding ? (embedding.paragraphs[0].level & 1) === 1 : false

    for (const [rawStart, rawEnd] of wrapGlyphs(augmented, 0, augmented.length, maxWidth)) {
      const [rangeStart, rangeEnd] = trimEdgeWhitespace(augmented, rawStart, rawEnd)
      const augmentedGlyphs: number[] = []
      for (let i = rangeStart; i < rangeEnd; i++) {
        if (!augmented[i].control) augmentedGlyphs.push(i)
      }
      const count = augmentedGlyphs.length

      if (count === 0) {
        registerLine({ cells: [], width: 0, rtl, start: paraStart, end: paraStart, boundaryCols: [0], logicalWidths: [0] })
        continue
      }

      // Visual order starts logical; UAX #9 L2 flip segments are applied as
      // glyph-range reversals derived from the resolved levels.
      const order = augmentedGlyphs.slice()
      if (embedding) {
        const unitStart = starts[rangeStart]
        const unitEnd = starts[rangeEnd - 1] + augmented[rangeEnd - 1].char.length - 1
        for (const [fromUnits, toUnits] of bidi.getReorderSegments(augmentedText, embedding, unitStart, unitEnd)) {
          // Flip endpoints may land on LRI/PDI control glyphs, which are not
          // part of the visual order; clamp to the non-control glyphs inside
          // the flip range.
          const fromGlyph = unitToGlyph(starts, fromUnits!)
          const toGlyph = unitToGlyph(starts, toUnits!)
          let from = -1
          let to = -1
          for (let i = 0; i < order.length; i++) {
            const glyph = order[i]
            if (glyph < fromGlyph || glyph > toGlyph) continue
            if (from === -1) from = i
            to = i
          }
          if (from === -1 || to === -1) continue
          for (let i = from, j = to; i < j; i++, j--) {
            const tmp = order[i]
            order[i] = order[j]
            order[j] = tmp
          }
        }
      }

      const cells: BidiCell[] = []
      let col = 0
      let width = 0
      for (const augmentedIndex of order) {
        const glyphIndex = augmentedToLogical[augmentedIndex]
        const glyph = glyphs[glyphIndex]
        const rtlCell = embedding ? (levels[starts[augmentedIndex]] & 1) === 1 : false
        const mirrored = rtlCell ? bidi.getMirroredCharacter(glyph.char) : null
        cells.push({ char: mirrored ?? glyph.char, width: glyph.width, glyph: glyphIndex, col, rtl: rtlCell })
        col += glyph.width
        width += glyph.width
      }

      // Logical (unwrapped) glyph sequence of this line; boundary indices are
      // logical positions, independent of visual order.
      const logicalGlyphs = augmentedGlyphs.map((index) => augmentedToLogical[index])
      const localOfGlyph = new Map(logicalGlyphs.map((glyph, index) => [glyph, index]))
      const boundaryCols = Array.from({ length: count + 1 }, () => -1)
      const logicalWidths = Array.from({ length: count + 1 }, () => 0)
      for (let i = 0; i < count; i++) {
        logicalWidths[i + 1] = logicalWidths[i] + glyphs[logicalGlyphs[i]].width
      }
      for (const cell of cells) {
        const local = localOfGlyph.get(cell.glyph)!
        if (cell.rtl) {
          boundaryCols[local] = cell.col + cell.width
          boundaryCols[local + 1] = cell.col
        } else {
          boundaryCols[local] = cell.col
          boundaryCols[local + 1] = cell.col + cell.width
        }
      }
      for (let i = 0; i <= count; i++) {
        if (boundaryCols[i] !== -1) continue
        let j = i - 1
        while (j >= 0 && boundaryCols[j] === -1) j--
        boundaryCols[i] = j >= 0 ? boundaryCols[j] : 0
      }

      registerLine({
        cells,
        width,
        rtl,
        start: logicalGlyphs[0],
        end: logicalGlyphs[count - 1] + 1,
        boundaryCols,
        logicalWidths,
      })
    }

    paragraphs.push({
      start: paraStart,
      end: paraEnd,
      firstLine,
      lineCount: lines.length - firstLine,
      startWidth: boundaryWidths[paraStart],
    })
  }

  let paraStart = 0
  for (let i = 0; i < glyphs.length; i++) {
    if (!glyphs[i].newline) continue
    layoutParagraph(paraStart, i)
    boundaryLine[i] = lines.length - 1
    boundaryParagraph[i] = paragraphs.length - 1
    paraStart = i + 1
  }
  layoutParagraph(paraStart, glyphs.length)
  for (let g = 0; g <= glyphs.length; g++) {
    if (boundaryLine[g] === -1) boundaryLine[g] = Math.max(0, lines.length - 1)
    if (boundaryParagraph[g] === -1) boundaryParagraph[g] = Math.max(0, paragraphs.length - 1)
  }

  return { glyphs, lines, paragraphs, boundaryLine, boundaryWidths, boundaryParagraph }
}

// Maps a logical cursor (paragraph row plus logical width column) to a global
// boundary index. Width columns follow the native convention: each grapheme
// contributes its display width and a newline contributes one.
export function logicalCursorToBoundary(layout: BidiLayout, row: number, col: number) {
  const paragraph = layout.paragraphs[Math.min(Math.max(row, 0), layout.paragraphs.length - 1)]
  if (!paragraph) return 0
  let boundary = paragraph.start
  let width = paragraph.startWidth
  const target = Math.max(0, col)
  while (boundary < paragraph.end) {
    const glyph = layout.glyphs[boundary]
    if (width + glyph.width > target) break
    width += glyph.width
    boundary++
  }
  return boundary
}

// Maps a global boundary to its visual caret position (line index and visual
// column on that line).
export function boundaryToVisual(layout: BidiLayout, boundary: number) {
  const clamped = Math.max(0, Math.min(boundary, layout.boundaryLine.length - 1))
  const lineIndex = layout.boundaryLine[clamped]
  const line = layout.lines[lineIndex]
  if (!line) return { line: 0, col: 0 }
  const local = Math.max(0, Math.min(clamped - line.start, line.boundaryCols.length - 1))
  return { line: lineIndex, col: line.boundaryCols[local] ?? 0 }
}

// Inverse mapping: a visual caret position to the closest global boundary,
// used for caret motion and hit testing.
export function visualToBoundary(layout: BidiLayout, lineIndex: number, col: number) {
  const line = layout.lines[Math.max(0, Math.min(lineIndex, layout.lines.length - 1))]
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < line.boundaryCols.length; i++) {
    const distance = Math.abs((line.boundaryCols[i] ?? 0) - col)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return line.start + best
}

// Steps one caret position visually left (-1) or right (+1), crossing line
// boundaries the way bidi-aware editors do.
export function visualStep(layout: BidiLayout, boundary: number, dir: -1 | 1) {
  const position = boundaryToVisual(layout, boundary)
  const line = layout.lines[position.line]
  const cols = line.boundaryCols
  if (dir < 0) {
    let candidate = -1
    for (let i = 0; i < cols.length; i++) {
      const value = cols[i]
      if (value < position.col && (candidate === -1 || value > cols[candidate])) candidate = i
    }
    if (candidate !== -1) return line.start + candidate
    if (position.line > 0) {
      const previous = layout.lines[position.line - 1]
      let maxIndex = 0
      for (let i = 1; i < previous.boundaryCols.length; i++) {
        if ((previous.boundaryCols[i] ?? 0) > (previous.boundaryCols[maxIndex] ?? 0)) maxIndex = i
      }
      return previous.start + maxIndex
    }
    return boundary
  }
  let candidate = -1
  for (let i = 0; i < cols.length; i++) {
    const value = cols[i]
    if (value > position.col && (candidate === -1 || value < cols[candidate])) candidate = i
  }
  if (candidate !== -1) return line.start + candidate
  if (position.line < layout.lines.length - 1) {
    const next = layout.lines[position.line + 1]
    let minIndex = 0
    for (let i = 1; i < next.boundaryCols.length; i++) {
      if ((next.boundaryCols[i] ?? 0) < (next.boundaryCols[minIndex] ?? 0)) minIndex = i
    }
    return next.start + minIndex
  }
  return boundary
}

// Converts a boundary back to native logical cursor coordinates.
export function boundaryToLogicalCursor(layout: BidiLayout, boundary: number) {
  const clamped = Math.max(0, Math.min(boundary, layout.boundaryWidths.length - 1))
  const paragraphIndex = layout.boundaryParagraph[clamped] ?? 0
  const paragraph = layout.paragraphs[paragraphIndex]
  if (!paragraph) return { row: 0, col: 0 }
  return { row: paragraphIndex, col: Math.max(0, layout.boundaryWidths[clamped] - paragraph.startWidth) }
}

// Global width offsets (native selection and cursor offsets) are
// display-width offsets; locate the boundary at or before the offset.
export function widthOffsetToBoundary(layout: BidiLayout, offset: number) {
  const widths = layout.boundaryWidths
  let lo = 0
  let hi = widths.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (widths[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

// Reconstructs wrapped logical text with explicit newlines at wrap points so
// the native text buffer can be kept in sync for measurement and selection
// while the stored content stays logically ordered.
export function wrappedLogicalText(layout: BidiLayout) {
  return layout.lines.map((line) => layout.glyphs.slice(line.start, line.end).map((g) => g.char).join("")).join("\n")
}
