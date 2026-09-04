import {
  OptimizedBuffer,
  RGBA,
  TargetChannel,
  TextRenderable,
  type RenderContext,
  type TextOptions,
} from "@opentui/core"
import { extend, type JSX } from "@opentui/solid"
import { splitProps } from "solid-js"
import { coast, intensityAt } from "./tab-pulse"

type ShimmerTextOptions = TextOptions & {
  shimmer: RGBA
}

const DURATION = 1200
const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0)
const CONTINUATION = 0xc0000000 | 0

class ShimmerTextRenderable extends TextRenderable {
  private _shimmer = RGBA.defaultForeground()
  private elapsed = 0
  private scratch: OptimizedBuffer | undefined
  private mask = new Float32Array(0)
  private matrix = new Float32Array(16)

  constructor(ctx: RenderContext, options: ShimmerTextOptions) {
    super(ctx, options)
    this.matrix[3] = this._shimmer.r
    this.matrix[7] = this._shimmer.g
    this.matrix[11] = this._shimmer.b
    this.matrix[15] = 1
    if (options.shimmer) this.shimmer = options.shimmer
    this.live = true
  }

  set shimmer(value: RGBA) {
    if (value.equals(this._shimmer)) return
    this._shimmer = value
    this.matrix[3] = value.r
    this.matrix[7] = value.g
    this.matrix[11] = value.b
    this.requestRender()
  }

  override render(buffer: OptimizedBuffer, deltaTime: number) {
    if (!this.visible || this.isDestroyed || !Number.isFinite(this.width) || this.width <= 0 || this.height <= 0) return
    this.elapsed = (this.elapsed + deltaTime) % DURATION
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
    const front = -4 + coast(this.elapsed / DURATION) * (end + 22)
    if (this.mask.length !== this.width * this.height * 3) this.mask = new Float32Array(this.width * this.height * 3)
    let strength = 0
    for (let cell = 0; cell < characters.length; cell++) {
      const column = cell % this.width
      if ((characters[cell] & CONTINUATION) !== CONTINUATION) strength = intensityAt(column, front, 4, 18)
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

extend({ shimmer_text: ShimmerTextRenderable })

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    shimmer_text: typeof ShimmerTextRenderable
  }
}

type Props = Omit<JSX.IntrinsicElements["text"], "ref"> & { shimmer: RGBA }

export function ShimmerText(props: Props) {
  const [local, text] = splitProps(props, ["shimmer"])
  return <shimmer_text {...text} shimmer={local.shimmer} />
}
