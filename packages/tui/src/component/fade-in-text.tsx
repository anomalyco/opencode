import { RGBA, type OptimizedBuffer, type RenderContext, type TextOptions } from "@opentui/core"
import { extend, type JSX } from "@opentui/solid"
import { splitProps } from "solid-js"
import { useConfig } from "../config"
import { MaskedTextRenderable } from "./masked-text"
import { coast, smootherstep } from "./tab-pulse"

type FadeInTextOptions = TextOptions & {
  backdrop?: RGBA
  enabled?: boolean
  sweepOffset?: number
  sweepWidth?: number
}

const DURATION = 200
const FEATHER = 8
const clamp = (value: number) => Math.max(0, Math.min(1, value))

class FadeInTextRenderable extends MaskedTextRenderable {
  private _backdrop = RGBA.defaultBackground()
  private _enabled = true
  private _sweepOffset = 0
  private _sweepWidth: number | undefined
  private elapsed = 0

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
    this.renderMasked(buffer, 1, (end) => {
      const progress = this.elapsed / DURATION
      const front = -FEATHER + coast(progress) * ((this._sweepWidth ?? end) + FEATHER * 2)
      return (column) => 1 - smootherstep(clamp((front - (this._sweepOffset + column)) / FEATHER))
    })
    if (this.elapsed >= DURATION) this.live = false
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
