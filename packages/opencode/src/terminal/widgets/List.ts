import { ScreenBuffer } from "../core/ScreenBuffer"
import type { Widget } from "./Widget"
import type { InputEvent } from "../input/InputHandler"

export class List implements Widget {
  dirty = true
  x = 0; y = 0; w = 0; h = 0
  items: string[] = []
  selectedIndex = 0
  scrollOffset = 0
  onSelect?: (index: number, item: string) => void

  setBounds(x: number, y: number, w: number, h: number): void {
    if (x === this.x && y === this.y && w === this.w && h === this.h) return
    this.x = x; this.y = y; this.w = w; this.h = h
    this.dirty = true
  }

  invalidate(): void { this.dirty = true }

  onKey(event: InputEvent): boolean {
    if (event.type !== "KEY") return false

    switch (event.key) {
      case "ArrowUp":
        if (this.selectedIndex > 0) {
          this.selectedIndex--
          if (this.selectedIndex < this.scrollOffset) this.scrollOffset = this.selectedIndex
          this.dirty = true
        }
        return true

      case "ArrowDown":
        if (this.selectedIndex < this.items.length - 1) {
          this.selectedIndex++
          if (this.selectedIndex >= this.scrollOffset + this.h) this.scrollOffset = this.selectedIndex - this.h + 1
          this.dirty = true
        }
        return true

      case "PageUp":
        this.selectedIndex = Math.max(0, this.selectedIndex - this.h)
        if (this.selectedIndex < this.scrollOffset) this.scrollOffset = this.selectedIndex
        this.dirty = true
        return true

      case "PageDown":
        this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + this.h)
        if (this.selectedIndex >= this.scrollOffset + this.h) this.scrollOffset = this.selectedIndex - this.h + 1
        this.dirty = true
        return true

      case "Home":
        this.selectedIndex = 0
        this.scrollOffset = 0
        this.dirty = true
        return true

      case "End":
        this.selectedIndex = this.items.length - 1
        this.scrollOffset = Math.max(0, this.selectedIndex - this.h + 1)
        this.dirty = true
        return true

      case "Enter":
        this.onSelect?.(this.selectedIndex, this.items[this.selectedIndex] ?? "")
        return true
    }

    return false
  }

  render(buffer: ScreenBuffer): void {
    this.dirty = false
    const first = this.scrollOffset
    const last = Math.min(first + this.h, this.items.length)

    for (let i = 0; i < this.h; i++) {
      const idx = first + i
      let line: string
      if (idx < last) {
        line = this.items[idx] ?? ""
      } else {
        line = ""
      }

      let col = 0
      const fg = idx === this.selectedIndex ? 0 : 15
      const bg = idx === this.selectedIndex ? 15 : 0
      for (const ch of line) {
        if (col >= this.w) break
        buffer.setCell(this.x + col, this.y + i, ch.codePointAt(0) ?? 32, fg, bg, 0)
        col++
      }
      for (let c = col; c < this.w; c++) {
        buffer.setCell(this.x + c, this.y + i, 32, fg, bg, 0)
      }
    }
  }
}
