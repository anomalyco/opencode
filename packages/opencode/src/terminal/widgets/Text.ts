import { ScreenBuffer } from "../core/ScreenBuffer"
import { getCodePointWidth, stringWidth } from "../utils/WidthUtils"
import type { Widget } from "./Widget"

export class Text implements Widget {
  dirty = true
  x = 0; y = 0; w = 0; h = 0
  private _content = ""
  private lines: string[] = []

  get content(): string { return this._content }

  set content(val: string) {
    if (val === this._content) return
    this._content = val
    this.dirty = true
    this.reflow()
  }

  setBounds(x: number, y: number, w: number, h: number): void {
    if (x === this.x && y === this.y && w === this.w && h === this.h) return
    const oldW = this.w
    this.x = x; this.y = y; this.w = w; this.h = h
    if (oldW !== w) this.reflow()
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  render(buffer: ScreenBuffer): void {
    this.dirty = false
    for (let i = 0; i < this.h && i < this.lines.length; i++) {
      const line = this.lines[i]
      let col = 0
      for (const ch of line) {
        if (col >= this.w) break
        const cp = ch.codePointAt(0) ?? 32
        const cw = getCodePointWidth(cp)
        if (col + cw > this.w) break
        buffer.setCell(this.x + col, this.y + i, cp, 15, 0, 0)
        col += cw
      }
      for (let c = col; c < this.w; c++) {
        buffer.setCell(this.x + c, this.y + i, 32, 15, 0, 0)
      }
    }
    for (let i = this.lines.length; i < this.h; i++) {
      for (let c = 0; c < this.w; c++) {
        buffer.setCell(this.x + c, this.y + i, 32, 15, 0, 0)
      }
    }
  }

  private reflow(): void {
    if (this.w <= 0) { this.lines = []; return }
    this.lines = wordWrap(this._content, this.w)
  }
}

export function wordWrap(text: string, maxWidth: number): string[] {
  if (!text || maxWidth <= 0) return []
  const lines: string[] = []
  let current = ""
  let currentW = 0

  const tokens = text.split(/(\s+)/)

  for (const token of tokens) {
    const tw = stringWidth(token)

    if (currentW + tw > maxWidth) {
      if (current.length > 0) {
        lines.push(current)
        current = ""
        currentW = 0
      }

      if (tw > maxWidth) {
        let remaining = token
        while (stringWidth(remaining) > maxWidth) {
          let chunk = ""
          let chunkW = 0
          for (const ch of remaining) {
            const cw = getCodePointWidth(ch.codePointAt(0) ?? 32)
            if (chunkW + cw > maxWidth) break
            chunk += ch; chunkW += cw
          }
          if (chunk.length > 0) lines.push(chunk)
          remaining = remaining.slice(chunk.length)
        }
        if (remaining.length > 0) { current = remaining; currentW = stringWidth(remaining) }
      } else {
        current = token; currentW = tw
      }
    } else {
      current += token; currentW += tw
    }
  }

  if (current.length > 0) lines.push(current)
  return lines
}
