import { getCodePointWidth } from "../utils/WidthUtils"

function encodeCellPacked(cp: number, fg: number, bg: number, attr: number, width: number): bigint {
  const buf = new ArrayBuffer(8)
  const dv = new DataView(buf)
  dv.setInt32(0, cp, true)
  dv.setUint8(4, fg)
  dv.setUint8(5, bg)
  dv.setUint8(6, attr)
  dv.setUint8(7, width)
  return new BigUint64Array(buf)[0]
}

const PACKED_DEFAULT = encodeCellPacked(32, 0, 0, 0, 1)

export class ScreenBuffer {
  readonly buffer: ArrayBuffer
  readonly data: DataView
  readonly packed: BigUint64Array
  readonly dirtyRows: Uint32Array
  readonly width: number
  readonly height: number

  constructor(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new RangeError(`[ScreenBuffer] Invalid dimensions: ${width}×${height}`)
    }
    this.width = width
    this.height = height
    this.buffer = new ArrayBuffer(width * height * 8)
    this.data = new DataView(this.buffer)
    this.packed = new BigUint64Array(this.buffer)
    this.dirtyRows = new Uint32Array(Math.ceil(height / 32))
    this.clear()
  }

  private off(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new RangeError(
        `[ScreenBuffer.off] (${x},${y}) out of bounds in ${this.width}×${this.height} buffer`,
      )
    }
    return (y * this.width + x) * 8
  }

  private idx(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new RangeError(
        `[ScreenBuffer.idx] (${x},${y}) out of bounds in ${this.width}×${this.height} buffer`,
      )
    }
    return y * this.width + x
  }

  setCell(
    x: number, y: number,
    cp: number,
    fg: number, bg: number,
    attrMask: number,
  ): void {
    const o = this.off(x, y)
    this.data.setInt32(o, cp, true)
    this.data.setUint8(o + 4, fg)
    this.data.setUint8(o + 5, bg)
    this.data.setUint8(o + 6, attrMask)
    const w = getCodePointWidth(cp)
    this.data.setUint8(o + 7, w)
    this.dirtyRows[y >> 5] |= 1 << (y & 31)

    if (w === 2 && x + 1 < this.width) {
      const o2 = this.off(x + 1, y)
      this.data.setInt32(o2, 32, true)
      this.data.setUint8(o2 + 4, fg)
      this.data.setUint8(o2 + 5, bg)
      this.data.setUint8(o2 + 6, 0)
      this.data.setUint8(o2 + 7, 0)
    }
  }

  getCodePoint(x: number, y: number): number {
    return this.data.getInt32(this.off(x, y), true)
  }

  getFg(x: number, y: number): number {
    return this.data.getUint8(this.off(x, y) + 4)
  }

  getBg(x: number, y: number): number {
    return this.data.getUint8(this.off(x, y) + 5)
  }

  getAttr(x: number, y: number): number {
    return this.data.getUint8(this.off(x, y) + 6)
  }

  getCellWidth(x: number, y: number): number {
    return this.data.getUint8(this.off(x, y) + 7)
  }

  cellEquals(x: number, y: number, other: ScreenBuffer, ox: number, oy: number): boolean {
    const i = this.idx(x, y)
    const j = other.idx(ox, oy)
    return this.packed[i] === other.packed[j]
  }

  clear(): void {
    this.packed.fill(PACKED_DEFAULT)
    this.dirtyRows.fill(0)
  }

  clone(): ScreenBuffer {
    const copy = new ScreenBuffer(this.width, this.height)
    copy.packed.set(this.packed)
    copy.dirtyRows.set(this.dirtyRows)
    return copy
  }

  copyFrom(other: ScreenBuffer): void {
    if (other.width !== this.width || other.height !== this.height) {
      throw new Error("[ScreenBuffer.copyFrom] Dimension mismatch")
    }
    this.packed.set(other.packed)
    this.dirtyRows.set(other.dirtyRows)
  }
}
