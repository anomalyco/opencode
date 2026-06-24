import { ScreenBuffer } from "./ScreenBuffer"
import { AttrMask } from "./Cell"
import { globalFlyweight } from "./SgrDelta"

function encodeCellSGR(curr: ScreenBuffer, x: number, y: number): string {
  const fg = curr.getFg(x, y)
  const bg = curr.getBg(x, y)
  const attr = curr.getAttr(x, y)
  return globalFlyweight.encode(fg, bg, attr)
}

interface Span { sx: number; ex: number; y: number }

function findSpans(prev: ScreenBuffer, curr: ScreenBuffer): Span[] {
  const w = curr.width
  const h = curr.height
  const spans: Span[] = []
  const p = prev.packed
  const c = curr.packed
  const dirty = curr.dirtyRows
  const useBitset = dirty.some(b => b !== 0)

  for (let y = 0; y < h; y++) {
    if (useBitset && !(dirty[y >> 5] & (1 << (y & 31)))) continue

    const rowBase = y * w
    let x = 0
    while (x < w) {
      while (x < w && p[rowBase + x] === c[rowBase + x]) x++
      if (x >= w) break
      const sx = x
      while (x < w && p[rowBase + x] !== c[rowBase + x]) x++
      spans.push({ sx, ex: x, y })
    }
  }

  return spans
}

export function computeDirtyDiff(prev: ScreenBuffer, curr: ScreenBuffer): string {
  const w = curr.width
  const spans = findSpans(prev, curr)
  if (spans.length === 0) return ""

  const parts: string[] = []
  let cursorX = -1
  let cursorY = -1

  for (const { sx, ex, y } of spans) {
    if (sx !== cursorX || y !== cursorY) {
      parts.push(`\x1b[${y + 1};${sx + 1}H`)
    }

    for (let x = sx; x < ex; x++) {
      const cw = curr.getCellWidth(x, y)
      if (cw === 0) continue

      parts.push(encodeCellSGR(curr, x, y))
      const cp = curr.getCodePoint(x, y)
      parts.push(String.fromCodePoint(cp))
      cursorX = x + cw
      cursorY = y
    }

    const lastX = ex - 1
    const lastCw = curr.getCellWidth(lastX, y)
    if (lastCw !== 0) {
      cursorX = lastX + lastCw
      cursorY = y
    }
  }

  parts.push("\x1b[0m")
  return parts.join("")
}
