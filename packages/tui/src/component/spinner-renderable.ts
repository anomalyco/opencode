import {
  parseColor,
  Renderable,
  RGBA,
  type ColorInput,
  type OptimizedBuffer,
  type RenderableOptions,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { stringWidth } from "../util/string-width"
import { SPINNER_FRAMES } from "./spinner-frames"

export type ColorGenerator = (
  frameIndex: number,
  charIndex: number,
  totalFrames: number,
  totalChars: number,
) => ColorInput

type SpinnerOptions = RenderableOptions<SpinnerRenderable> & {
  frames?: string[]
  interval?: number
  autoplay?: boolean
  color?: ColorInput | ColorGenerator
  backgroundColor?: ColorInput
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

// Not live: a live node keeps the renderer running, so renderer.idle(), which mini and the CLI await, never resolves.
// The renderer's shared animation clock ticks it instead, on frames it shares with other animations, while it is drawn.
export class SpinnerRenderable extends Renderable {
  private frameTexts: string[] = []
  private glyphs: { char: string; width: number }[][] = []
  private frameWidth = 0
  private _interval: number
  private _autoplay: boolean
  private _color: RGBA | ColorGenerator
  private _backgroundColor: RGBA
  private index = 0

  constructor(ctx: RenderContext, options: SpinnerOptions = {}) {
    super(ctx, options)
    this._interval = options.interval ?? 80
    this._autoplay = options.autoplay ?? true
    this._color = toColor(options.color ?? RGBA.defaultForeground())
    this._backgroundColor = parseColor(options.backgroundColor ?? "transparent")
    this.setMeasureProvider(() => ({ width: this.frameWidth, height: 1 }))
    this.frames = options.frames ?? SPINNER_FRAMES
  }

  set frames(value: string[]) {
    if (value.length === this.frameTexts.length && value.every((frame, index) => frame === this.frameTexts[index]))
      return
    this.frameTexts = value
    this.glyphs = value.map((frame) =>
      Array.from(graphemes.segment(frame), (part) => ({ char: part.segment, width: stringWidth(part.segment) })),
    )
    this.index = 0
    const width = Math.max(0, ...this.glyphs.map((glyphs) => glyphs.reduce((sum, glyph) => sum + glyph.width, 0)))
    if (width !== this.frameWidth) {
      this.frameWidth = width
      this.invalidateIntrinsicSize()
    }
    this.restart()
  }

  set interval(value: number) {
    if (value === this._interval) return
    this._interval = value
    this.restart()
  }

  set autoplay(value: boolean) {
    if (value === this._autoplay) return
    this._autoplay = value
    this.restart()
  }

  set color(value: ColorInput | ColorGenerator) {
    this._color = toColor(value)
    this.requestRender()
  }

  set backgroundColor(value: ColorInput) {
    this._backgroundColor = parseColor(value)
    this.requestRender()
  }

  private restart() {
    this.animationFps = this._autoplay && this.glyphs.length > 1 ? 1000 / this._interval : undefined
    this.requestRender()
  }

  protected override onAnimationTick(_deltaTime: number, ticks: number) {
    this.index = (this.index + ticks) % this.glyphs.length
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    const glyphs = this.glyphs[this.index]
    if (!glyphs) return
    let x = this.screenX
    glyphs.forEach((glyph, char) => {
      const color =
        typeof this._color === "function"
          ? parseColor(this._color(this.index, char, this.glyphs.length, glyphs.length))
          : this._color
      buffer.drawText(glyph.char, x, this.screenY, color, this._backgroundColor)
      x += glyph.width
    })
  }
}

function toColor(value: ColorInput | ColorGenerator) {
  return typeof value === "function" ? value : parseColor(value)
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    spinner: typeof SpinnerRenderable
  }
}

extend({ spinner: SpinnerRenderable })
