import { ScreenBuffer } from "../core/ScreenBuffer"
import type { Widget } from "../widgets/Widget"

export class Container implements Widget {
  dirty = true
  x = 0; y = 0; w = 0; h = 0

  setBounds(x: number, y: number, w: number, h: number): void {
    if (x === this.x && y === this.y && w === this.w && h === this.h) return
    this.x = x; this.y = y; this.w = w; this.h = h
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  render(buffer: ScreenBuffer): void {
    if (this.w < 2 || this.h < 2) return
    this.dirty = false

    const x0 = this.x, y0 = this.y, x1 = this.x + this.w - 1, y1 = this.y + this.h - 1

    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const isTop = cy === y0, isBot = cy === y1, isLef = cx === x0, isRig = cx === x1
        if (isTop && isLef) { buffer.setCell(cx, cy, 0x250c, 15, 4, 0); continue }
        if (isTop && isRig) { buffer.setCell(cx, cy, 0x2510, 15, 4, 0); continue }
        if (isBot && isLef) { buffer.setCell(cx, cy, 0x2514, 15, 4, 0); continue }
        if (isBot && isRig) { buffer.setCell(cx, cy, 0x2518, 15, 4, 0); continue }
        if (isTop || isBot) { buffer.setCell(cx, cy, 0x2500, 15, 4, 0); continue }
        if (isLef || isRig) { buffer.setCell(cx, cy, 0x2502, 15, 4, 0); continue }
        buffer.setCell(cx, cy, 0x20, 0, 0, 0)
      }
    }

    const title = "Phase 2 Active"
    const tx = this.x + Math.floor((this.w - title.length) / 2)
    if (tx >= x0 && tx + title.length <= x1 + 1) {
      for (let i = 0; i < title.length; i++) {
        buffer.setCell(tx + i, this.y, title.codePointAt(i) ?? 0x20, 15, 4, 0)
      }
    }

    const status = "Ctrl+C to exit"
    const sx = this.x + Math.floor((this.w - status.length) / 2)
    if (sx >= x0 && sx + status.length <= x1 + 1) {
      for (let i = 0; i < status.length; i++) {
        buffer.setCell(sx + i, y1, status.codePointAt(i) ?? 0x20, 15, 4, 0)
      }
    }
  }
}
