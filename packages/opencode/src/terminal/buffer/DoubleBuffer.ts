import { ScreenBuffer } from "../core/ScreenBuffer"
import { computeDirtyDiff } from "../core/DirtyDiff"

export class DoubleBuffer {
  private front: ScreenBuffer
  private back: ScreenBuffer

  constructor(width: number, height: number) {
    this.front = new ScreenBuffer(width, height)
    this.back = new ScreenBuffer(width, height)
  }

  get width(): number { return this.front.width }
  get height(): number { return this.front.height }

  getBack(): ScreenBuffer {
    return this.back
  }

  swap(): string {
    const diff = computeDirtyDiff(this.front, this.back)
    this.back.dirtyRows.fill(0)
    ;[this.front, this.back] = [this.back, this.front]
    return diff
  }

  resize(width: number, height: number): void {
    this.front = new ScreenBuffer(width, height)
    this.back = new ScreenBuffer(width, height)
  }
}
