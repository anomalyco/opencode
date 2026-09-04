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
import { useConfig } from "../config"
import { coast, smootherstep } from "./tab-pulse"

type FadeInTextOptions = TextOptions & {
  backdrop?: RGBA
  enabled?: boolean
  sweepOffset?: number
  sweepWidth?: number
}

const DURATION = 200
const FEATHER = 8
const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0)
const CONTINUATION = 0xc0000000 | 0
const clamp = (value: number) => Math.max(0, Math.min(1, value))

class FadeInTextRenderable extends TextRenderable {
  private _backdrop = RGBA.defaultBackground()
  private _enabled = true
  private _sweepOffset = 0
  private _sweepWidth: number | undefined
  private elapsed = 0
  private scratch: OptimizedBuffer | undefined
  private mask = new Float32Array(0)
  private matrix = new Float32Array(16)

  constructor(ctx: RenderContext, options: FadeInTextOptions) {
    super(ctx, options)
    this.matrix[15] = 1
    this.updateBackdrop()
    if (options.backdrop) this.backdrop = options.backdrop
    if (options.enabled === false) this.enabled = false
    this.live = this._enabled
  }

  set backdrop(value: RGBA) {
    if (value.equals(this._backdrop)) return
    this._backdrop = value
    this.updateBackdrop()
    this.requestRender()
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    this.live = value && this.elapsed < DURATION
    this.requestRender()
  }

  set sweepOffset(value: number | undefined) {
    this._sweepOffset = value ?? 0
    this.requestRender()
  }

  set sweepWidth(value: number | undefined) {
    this._sweepWidth = value
    this.requestRender()
  }

  private updateBackdrop() {
    this.matrix[3] = this._backdrop.r
    this.matrix[7] = this._backdrop.g
    this.matrix[11] = this._backdrop.b
  }

  override render(buffer: OptimizedBuffer, deltaTime: number) {
    if (!this._enabled || this.elapsed >= DURATION) return super.render(buffer, deltaTime)
    if (!this.visible || this.isDestroyed || !Number.isFinite(this.width) || this.width <= 0 || this.height <= 0) return
    this.elapsed = Math.min(DURATION, this.elapsed + deltaTime)
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
    const progress = this.elapsed / DURATION
    const front = -FEATHER + coast(progress) * ((this._sweepWidth ?? end) + FEATHER * 2)
    if (this.mask.length !== this.width * this.height * 3) this.mask = new Float32Array(this.width * this.height * 3)
    let strength = 1
    for (let cell = 0; cell < characters.length; cell++) {
      const column = cell % this.width
      if ((characters[cell] & CONTINUATION) !== CONTINUATION)
        strength = 1 - smootherstep(clamp((front - (this._sweepOffset + column)) / FEATHER))
      this.mask[cell * 3] = column
      this.mask[cell * 3 + 1] = Math.floor(cell / this.width)
      this.mask[cell * 3 + 2] = strength
    }
    this.scratch.colorMatrix(this.matrix, this.mask, 1, TargetChannel.FG)
    buffer.drawFrameBuffer(this.screenX, this.screenY, this.scratch)
    this.markClean()
    this._ctx.addToHitGrid(this.screenX, this.screenY, this.width, this.height, this.num)
    if (this.elapsed >= DURATION) this.live = false
  }

  override destroy() {
    this.scratch?.destroy()
    this.scratch = undefined
    super.destroy()
  }
}

extend({ fade_in_text: FadeInTextRenderable })

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    fade_in_text: typeof FadeInTextRenderable
  }
}

type Props = Omit<JSX.IntrinsicElements["text"], "ref"> & {
  animate?: boolean
  backdrop?: RGBA
  sweepOffset?: number
  sweepWidth?: number
}

export function FadeInText(props: Props) {
  const config = useConfig().data
  const [local, text] = splitProps(props, ["animate", "backdrop", "sweepOffset", "sweepWidth"])
  return (
    <fade_in_text
      {...text}
      backdrop={local.backdrop}
      enabled={(local.animate ?? true) && (config.animations ?? true)}
      sweepOffset={local.sweepOffset}
      sweepWidth={local.sweepWidth}
    />
  )
}
