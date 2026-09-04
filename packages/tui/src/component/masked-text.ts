import { OptimizedBuffer, RGBA, TargetChannel, TextRenderable } from "@opentui/core"

const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0)
const CONTINUATION = 0xc0000000 | 0

export class MaskedTextRenderable extends TextRenderable {
  protected readonly matrix = new Float32Array(16)
  private scratch: OptimizedBuffer | undefined
  private mask = new Float32Array(0)

  protected renderMasked(
    buffer: OptimizedBuffer,
    initialStrength: number,
    shade: (width: number) => (column: number) => number,
  ) {
    if (!this.scratch)
      this.scratch = OptimizedBuffer.create(this.width, this.height, this._ctx.widthMethod, { respectAlpha: true })
    if (this.scratch.width !== this.width || this.scratch.height !== this.height)
      this.scratch.resize(this.width, this.height)

    this.scratch.clear(TRANSPARENT)
    this.scratch.drawTextBuffer(this.textBufferView, 0, 0)
    const characters = this.scratch.buffers.char
    let end = 0
    for (let row = 0; row < this.height; row++) {
      let column = this.width
      while (
        column > 0 &&
        (characters[row * this.width + column - 1] === 32 || characters[row * this.width + column - 1] === 0)
      )
        column--
      end = Math.max(end, column)
    }
    const intensity = shade(end)
    if (this.mask.length !== this.width * this.height * 3) this.mask = new Float32Array(this.width * this.height * 3)
    let strength = initialStrength
    for (let cell = 0; cell < characters.length; cell++) {
      const column = cell % this.width
      // Wide glyph continuation cells retain the head cell's intensity.
      if ((characters[cell] & CONTINUATION) !== CONTINUATION) strength = intensity(column)
      this.mask[cell * 3] = column
      this.mask[cell * 3 + 1] = Math.floor(cell / this.width)
      this.mask[cell * 3 + 2] = strength
    }
    this.scratch.colorMatrix(this.matrix, this.mask, 1, TargetChannel.FG)
    buffer.drawFrameBuffer(this.screenX, this.screenY, this.scratch)
    this.markClean()
    this._ctx.addToHitGrid(this.screenX, this.screenY, this.width, this.height, this.num)
  }

  override destroy() {
    this.scratch?.destroy()
    this.scratch = undefined
    super.destroy()
  }
}
