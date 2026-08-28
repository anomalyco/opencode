import {
  BoxRenderable,
  OptimizedBuffer,
  RGBA,
  TargetChannel,
  TextRenderable,
  type RenderContext,
  type TextOptions,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { coast, intensityAt } from "./tab-pulse"

type TitleShimmerOptions = TextOptions & {
  rename?: { title: string; pending: boolean }
  enabled?: boolean
  backdrop?: RGBA
}

const SHIMMER_DURATION = 1200
const ARRIVAL_DURATION = 450
const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0)
// Native text draws wide glyphs as a head followed by flagged continuation cells.
const CONTINUATION = 0xc0000000 | 0

export class TitleShimmerRenderable extends TextRenderable {
  private _rename: TitleShimmerOptions["rename"]
  private _enabled: boolean
  private _backdrop: RGBA
  private pendingTitle: string | undefined
  private elapsed = 0
  private arrival: number | undefined
  private scratch: OptimizedBuffer | undefined
  private previous: OptimizedBuffer | undefined
  private mask = new Float32Array(0)
  private matrix = new Float32Array(16)

  constructor(ctx: RenderContext, options: TitleShimmerOptions) {
    super(ctx, options)
    this._rename = options.rename
    this.pendingTitle = options.rename?.title
    this._enabled = options.enabled ?? true
    this._backdrop = options.backdrop ?? RGBA.defaultBackground()
    this.matrix[15] = 1
    this.updateBackdrop()
    this.live = this.animating
  }

  private get animating() {
    return this._enabled && (this.shimmering || this.arrival !== undefined)
  }

  private get shimmering() {
    return this._rename?.pending && this._rename.title === this.pendingTitle
  }

  set rename(value: TitleShimmerOptions["rename"]) {
    if (value?.title === this._rename?.title && value?.pending === this._rename?.pending) return
    if (value?.pending && !this._rename?.pending) {
      this.pendingTitle = value.title
      this.elapsed = 0
      this.arrival = undefined
      this.previous?.destroy()
      this.previous = undefined
    }
    // Only an automatic rename replaces the last painted title with a wipe.
    if (value?.title !== this._rename?.title) {
      this.arrival = value && this._rename?.pending && this._enabled && this.previous ? 0 : undefined
    }
    this._rename = value
    this.changed()
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    if (!value) this.arrival = undefined
    this.changed()
  }

  set backdrop(value: RGBA) {
    if (value.equals(this._backdrop)) return
    this._backdrop = value
    this.updateBackdrop()
    this.requestRender()
  }

  private updateBackdrop() {
    this.matrix[3] = this._backdrop.r
    this.matrix[7] = this._backdrop.g
    this.matrix[11] = this._backdrop.b
  }

  private changed() {
    this.live = this.animating
    if (!this.animating) {
      this.previous?.destroy()
      this.previous = undefined
    }
    this.requestRender()
  }

  override render(buffer: OptimizedBuffer, deltaTime: number) {
    if (!this.visible || this.isDestroyed || !Number.isFinite(this.width) || this.width <= 0 || this.height <= 0) return
    if (this.arrival !== undefined) {
      this.arrival += deltaTime
      if (this.arrival >= ARRIVAL_DURATION) {
        this.arrival = undefined
        this.previous?.destroy()
        this.previous = undefined
        this.live = this.animating
      }
    }
    if (!this.animating) return super.render(buffer, deltaTime)
    if (!this.scratch)
      this.scratch = OptimizedBuffer.create(this.width, this.height, this._ctx.widthMethod, { respectAlpha: true })
    if (this.scratch.width !== this.width || this.scratch.height !== this.height)
      this.scratch.resize(this.width, this.height)

    // Shade locally, then composite: colorMatrix itself does not respect ancestor scissors.
    this.scratch.clear(TRANSPARENT)
    // OpenTUI's framebuffer compositor can paint a cut wide glyph. Clip the native text draw first.
    const clip = {
      left: Math.max(0, -this.screenX),
      top: Math.max(0, -this.screenY),
      right: Math.min(this.width, buffer.width - this.screenX),
      bottom: Math.min(this.height, buffer.height - this.screenY),
    }
    for (let parent = this.parent; parent; parent = parent.parent) {
      if (parent.overflow === "visible" || parent.width <= 0 || parent.height <= 0) continue
      const border = parent instanceof BoxRenderable ? parent.border : false
      const left = Number(border === true || (Array.isArray(border) && border.includes("left")))
      const top = Number(border === true || (Array.isArray(border) && border.includes("top")))
      clip.left = Math.max(clip.left, parent.screenX - this.screenX + left)
      clip.top = Math.max(clip.top, parent.screenY - this.screenY + top)
      clip.right = Math.min(
        clip.right,
        parent.screenX -
          this.screenX +
          parent.width -
          Number(border === true || (Array.isArray(border) && border.includes("right"))),
      )
      clip.bottom = Math.min(
        clip.bottom,
        parent.screenY -
          this.screenY +
          parent.height -
          Number(border === true || (Array.isArray(border) && border.includes("bottom"))),
      )
    }
    this.scratch.pushScissorRect(
      clip.left,
      clip.top,
      Math.max(0, clip.right - clip.left),
      Math.max(0, clip.bottom - clip.top),
    )
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
    if (this.arrival !== undefined && this.previous) {
      const cut = Math.round(coast(this.arrival / ARRIVAL_DURATION) * Math.max(end, this.previous.width))
      this.scratch.clear(TRANSPARENT)
      this.scratch.pushScissorRect(0, 0, cut, this.height)
      this.scratch.drawTextBuffer(this.textBufferView, 0, 0)
      this.scratch.popScissorRect()
      // Snapshot slices must also end on whole glyphs; framebuffer clipping alone can split them.
      for (let row = 0; row < Math.min(this.height, this.previous.height); row++) {
        let left = Math.max(cut, clip.left)
        let right = Math.min(this.previous.width, clip.right)
        const offset = row * this.previous.width
        while (left < right && (this.previous.buffers.char[offset + left] & CONTINUATION) === CONTINUATION) left++
        while (
          right > left &&
          right < this.previous.width &&
          (this.previous.buffers.char[offset + right] & CONTINUATION) === CONTINUATION
        )
          right--
        if (right > left) this.scratch.drawFrameBuffer(left, row, this.previous, left, row, right - left, 1)
      }
      this.scratch.clearScissorRects()
      buffer.drawFrameBuffer(this.screenX, this.screenY, this.scratch)
      this.markClean()
      this._ctx.addToHitGrid(this.screenX, this.screenY, this.width, this.height, this.num)
      return
    }
    this.scratch.clearScissorRects()
    if (this.mask.length !== this.width * this.height * 3) this.mask = new Float32Array(this.width * this.height * 3)
    if (!this.previous)
      this.previous = OptimizedBuffer.create(Math.max(1, end), this.height, this._ctx.widthMethod, {
        respectAlpha: true,
      })
    if (this.previous.width !== Math.max(1, end) || this.previous.height !== this.height)
      this.previous.resize(Math.max(1, end), this.height)
    this.previous.clear(TRANSPARENT)
    this.previous.drawFrameBuffer(0, 0, this.scratch)
    this.elapsed = (this.elapsed + deltaTime) % SHIMMER_DURATION
    const front = -4 + coast(this.elapsed / SHIMMER_DURATION) * (end + 4 + 18)
    let strength = 0
    for (let cell = 0; cell < characters.length; cell++) {
      const column = cell % this.width
      if ((characters[cell] & CONTINUATION) !== CONTINUATION) strength = 0.6 * (1 - intensityAt(column, front, 4, 18))
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
    this.previous?.destroy()
    this.previous = undefined
    this.scratch?.destroy()
    this.scratch = undefined
    super.destroy()
  }
}

extend({ title_shimmer: TitleShimmerRenderable })

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    title_shimmer: typeof TitleShimmerRenderable
  }
}
