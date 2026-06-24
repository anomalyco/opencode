import { ScreenBuffer } from "../core/ScreenBuffer"
import type { Widget } from "./Widget"

const FILL = 0x2588
const EMPTY = 0x2500

export class ProgressBar implements Widget {
  dirty = true
  x = 0; y = 0; w = 0; h = 0
  value = 0
  indeterminate = false
  private phase = 0

  setBounds(x: number, y: number, w: number, h: number): void {
    if (x === this.x && y === this.y && w === this.w && h === this.h) return
    this.x = x; this.y = y; this.w = w; this.h = h
    this.dirty = true
  }

  invalidate(): void { this.dirty = true }

  onTick(): void {
    if (this.indeterminate) {
      this.phase = (this.phase + 1) % (Math.max(1, this.w - 2) * 2)
      this.dirty = true
    }
  }

  render(buffer: ScreenBuffer): void {
    this.dirty = false
    const barW = Math.max(1, this.w - 2)

    if (this.indeterminate) {
      const maxPhase = barW * 2
      const pos = this.phase < barW ? this.phase : maxPhase - this.phase
      buffer.setCell(this.x, this.y, 0x005b, 15, 0, 0)
      for (let i = 0; i < barW; i++) {
        buffer.setCell(this.x + 1 + i, this.y, i === pos ? 0x2592 : EMPTY, 15, 0, 0)
      }
      buffer.setCell(this.x + 1 + barW, this.y, 0x005d, 15, 0, 0)
    } else {
      const filled = Math.round((this.value / 100) * barW)
      buffer.setCell(this.x, this.y, 0x005b, 15, 0, 0)
      for (let i = 0; i < barW; i++) {
        buffer.setCell(this.x + 1 + i, this.y, i < filled ? FILL : EMPTY, 15, 0, 0)
      }
      buffer.setCell(this.x + 1 + barW, this.y, 0x005d, 15, 0, 0)

      const pct = `${Math.round(this.value)}%`
      const pctX = this.x + 1 + Math.floor((barW - pct.length) / 2)
      for (let i = 0; i < pct.length; i++) {
        buffer.setCell(pctX + i, this.y, pct.codePointAt(i) ?? 32, 0, 15, 0)
      }
    }
  }
}
