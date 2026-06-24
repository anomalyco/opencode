import { ScreenBuffer } from "../core/ScreenBuffer"
import type { Widget } from "./Widget"
import { Flex } from "../layout/Flex"
import type { LayoutNode } from "../layout/Types"
import type { InputEvent } from "../input/InputHandler"

interface LayoutWidget extends Widget {
  direction?: "row" | "column"
  grow?: number
  shrink?: number
  basis?: number
  padding?: [number, number, number, number]
  margin?: [number, number, number, number]
  borderWidth?: number
  children?: Widget[]
}

function stubChildren(children: Widget[]): LayoutNode[] {
  if (children.length === 0) return []
  return children.map(() => ({
    direction: "column", grow: 0, shrink: 0, basis: 0,
    padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], borderWidth: 0,
    x: 0, y: 0, width: 1, height: 1, children: [],
  }))
}

export class Box implements Widget {
  dirty = true
  x = 0; y = 0; w = 0; h = 0
  direction: "row" | "column" = "column"
  grow = 0; shrink = 0; basis = 0
  padding: [number, number, number, number] = [0, 0, 0, 0]
  margin: [number, number, number, number] = [0, 0, 0, 0]
  borderWidth = 0
  title = ""
  children: Widget[] = []
  onKey?: (event: InputEvent) => boolean
  onFocus?: () => void
  onBlur?: () => void

  private flex = new Flex()

  setBounds(x: number, y: number, w: number, h: number): void {
    if (x === this.x && y === this.y && w === this.w && h === this.h) return
    this.x = x; this.y = y; this.w = w; this.h = h
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  render(buffer: ScreenBuffer): void {
    this.dirty = false

    if (this.borderWidth > 0) {
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
        }
      }

      if (this.title) {
        let tw = 0
        for (const ch of this.title) tw += ch.codePointAt(0) !== undefined ? 1 : 1
        const tx = this.x + Math.floor((this.w - tw) / 2)
        for (let i = 0; i < this.title.length; i++) {
          buffer.setCell(tx + i, this.y, this.title.codePointAt(i) ?? 0x20, 15, 4, 0)
        }
      }
    }

    if (this.children.length > 0) {
      const pad = this.padding
      const bw = this.borderWidth
      const innerX = this.x + bw + pad[3]
      const innerY = this.y + bw + pad[0]
      const innerW = Math.max(1, this.w - bw * 2 - pad[1] - pad[3])
      const innerH = Math.max(1, this.h - bw * 2 - pad[0] - pad[2])

      const layoutNodes = this.children.map(child => {
        const b = child as LayoutWidget
        return {
          direction: b.direction ?? "column",
          grow: b.grow ?? 0,
          shrink: b.shrink ?? 0,
          basis: b.basis ?? 0,
          padding: b.padding ?? [0, 0, 0, 0],
          margin: b.margin ?? [0, 0, 0, 0],
          borderWidth: b.borderWidth ?? 0,
          x: 0, y: 0, width: innerW, height: innerH,
          children: b.children ? stubChildren(b.children) : [],
        }
      })

      const root = {
        direction: this.direction, grow: 0, shrink: 0, basis: 0,
        padding: [0, 0, 0, 0] as [number, number, number, number],
        margin: [0, 0, 0, 0] as [number, number, number, number],
        borderWidth: 0,
        x: innerX, y: innerY, width: innerW, height: innerH,
        children: layoutNodes,
      }

      this.flex.solve(root, innerW, innerH)

      for (let i = 0; i < this.children.length; i++) {
        const child = this.children[i]
        const node = layoutNodes[i]
        child.setBounds(node.x, node.y, Math.max(0, node.width), Math.max(0, node.height))
        if (child.dirty) child.render(buffer)
      }
    }
  }
}
