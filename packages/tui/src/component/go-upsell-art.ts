import {
  Renderable,
  RGBA,
  TextAttributes,
  type OptimizedBuffer,
  type RenderableOptions,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { go } from "../logo"

// Ported from the v1 TUI's Go upsell (bg-pulse-render.ts): rings radiate from the GO logo while a shimmer crosses it.
const PERIOD = 4600
const RINGS = 3
const WIDTH = 3.8
const TAIL = 9.5
const AMP = 0.55
const TAIL_AMP = 0.16
const BREATH_AMP = 0.05
const BREATH_SPEED = 0.0008
// Offset so the background ring emits from the GO center when the logo shimmer peaks.
const PHASE_OFFSET = 0.29
// The frame shown when animations are off.
const STILL = PERIOD * 0.5
const LOGO_LEFT_WIDTH = go.left[0]?.length ?? 0
const LOGO_LINES = go.left.map((line, index) => line + " " + go.right[index])
const LOGO_WIDTH = LOGO_LINES[0]?.length ?? 0
const LOGO_HEIGHT = LOGO_LINES.length
const LOGO_REACH = Math.hypot(LOGO_WIDTH, LOGO_HEIGHT * 2) + 3
const SPACE = 32
const UPPER_HALF = "▀".codePointAt(0)!

const enum Glyph {
  None,
  Shadow,
  ShadowTop,
  ShadowBottom,
  Block,
  Other,
}
const GLYPHS: Record<string, Glyph> = {
  " ": Glyph.None,
  _: Glyph.Shadow,
  "^": Glyph.ShadowTop,
  "~": Glyph.ShadowBottom,
}

// The logo never changes, so its glyphs and the distance of each half-cell from its centre are fixed.
const LOGO_GLYPH = new Uint8Array(LOGO_WIDTH * LOGO_HEIGHT)
const LOGO_CHAR = new Uint32Array(LOGO_WIDTH * LOGO_HEIGHT)
const LOGO_ATTRIBUTES = new Uint32Array(LOGO_WIDTH * LOGO_HEIGHT)
const LOGO_TOP_DIST = new Float64Array(LOGO_WIDTH * LOGO_HEIGHT)
const LOGO_BOTTOM_DIST = new Float64Array(LOGO_WIDTH * LOGO_HEIGHT)
LOGO_LINES.forEach((line, ly) => {
  Array.from(line).forEach((char, lx) => {
    const index = ly * LOGO_WIDTH + lx
    LOGO_GLYPH[index] = GLYPHS[char] ?? (char === "█" ? Glyph.Block : Glyph.Other)
    LOGO_CHAR[index] = char.codePointAt(0) ?? SPACE
    LOGO_ATTRIBUTES[index] = lx > LOGO_LEFT_WIDTH ? TextAttributes.BOLD : 0
    LOGO_TOP_DIST[index] = Math.hypot(lx + 0.5 - LOGO_WIDTH / 2, ly * 2 - LOGO_HEIGHT)
    LOGO_BOTTOM_DIST[index] = Math.hypot(lx + 0.5 - LOGO_WIDTH / 2, ly * 2 + 1 - LOGO_HEIGHT)
  })
})

type Options = RenderableOptions<GoUpsellArtRenderable> & {
  animate?: boolean
  background?: RGBA
  primary?: RGBA
  logoBase?: RGBA
  /** The logo is centred on this renderable's rows. */
  logoAnchor?: Renderable
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const ease = (phase: number) => {
  const envelope = Math.sin(phase * Math.PI)
  return envelope * envelope * (3 - 2 * envelope)
}
const mix = (out: RGBA, a: RGBA, b: RGBA, amount: number) => {
  const t = clamp(amount)
  out.r = a.r + (b.r - a.r) * t
  out.g = a.g + (b.g - a.g) * t
  out.b = a.b + (b.b - a.b) * t
  out.a = 1
  return out
}
const put = (plane: Uint16Array, offset: number, color: RGBA) => {
  const source = color.buffer
  plane[offset] = source[0]!
  plane[offset + 1] = source[1]!
  plane[offset + 2] = source[2]!
  plane[offset + 3] = source[3]!
}

/**
 * Draws into its own frame buffer (`buffered`) through `withBuffers`, so a frame is plain typed-array
 * writes plus one blit instead of a recorded draw call per cell. Live (and so the renderer's frame loop)
 * only while animating and visible; a still frame is drawn once and reused until something changes.
 */
export class GoUpsellArtRenderable extends Renderable {
  private elapsed: number
  private _animate: boolean
  private _background = RGBA.fromInts(0, 0, 0)
  private _primary = RGBA.fromInts(255, 255, 255)
  private _logoBase = RGBA.fromInts(180, 180, 180)
  private anchor: Renderable | undefined
  private readonly white = RGBA.fromInts(255, 255, 255)
  private readonly shadow = RGBA.fromInts(0, 0, 0)
  private readonly pulse = RGBA.fromInts(0, 0, 0)
  private readonly fg = RGBA.fromInts(0, 0, 0)
  private readonly bg = RGBA.fromInts(0, 0, 0)
  private readonly ringHeads = new Float64Array(RINGS)
  private readonly ringEased = new Float64Array(RINGS)
  private readonly logoHeads = new Float64Array(2)
  private readonly logoEased = new Float64Array(2)
  private peak = 0
  private glow = 0
  // Distance and falloff for every cell, rebuilt only when the size or logo position changes.
  private dist = new Float64Array(0)
  private falloff = new Float64Array(0)
  private fieldKey = ""
  private reach = 0
  private drawnKey = ""

  constructor(ctx: RenderContext, options: Options = {}) {
    const animate = options.animate ?? true
    super(ctx, { ...options, live: animate, buffered: true })
    this._animate = animate
    this.elapsed = animate ? 0 : STILL
    if (options.background) this._background = options.background
    if (options.primary) this._primary = options.primary
    if (options.logoBase) this._logoBase = options.logoBase
    this.anchor = options.logoAnchor
  }

  set animate(value: boolean) {
    if (value === this._animate) return
    this._animate = value
    this.live = value
    if (!value) this.elapsed = STILL
    this.redraw()
  }

  set background(value: RGBA) {
    this._background = value
    this.redraw()
  }

  set primary(value: RGBA) {
    this._primary = value
    this.redraw()
  }

  set logoBase(value: RGBA) {
    this._logoBase = value
    this.redraw()
  }

  set logoAnchor(value: Renderable | undefined) {
    this.anchor = value
    this.redraw()
  }

  private redraw() {
    this.drawnKey = ""
    this.requestRender()
  }

  protected override onUpdate(deltaTime: number) {
    if (this._animate) this.elapsed = (this.elapsed + deltaTime) % PERIOD
  }

  protected override destroySelf() {
    this.live = false
    this.anchor = undefined
    this.dist = new Float64Array(0)
    this.falloff = new Float64Array(0)
    super.destroySelf()
  }

  private field(width: number, height: number, logoX: number, logoY: number) {
    const key = `${width}x${height}@${logoX},${logoY}`
    if (key === this.fieldKey) return
    this.fieldKey = key
    const centerX = logoX + LOGO_WIDTH / 2
    const centerY = logoY + LOGO_HEIGHT / 2
    const reach = Math.hypot(Math.max(centerX, width - centerX), Math.max(centerY, height - centerY) * 2) + TAIL
    this.reach = reach
    if (this.dist.length !== width * height) {
      this.dist = new Float64Array(width * height)
      this.falloff = new Float64Array(width * height)
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.hypot(x + 0.5 - centerX, (y + 0.5 - centerY) * 2)
        this.dist[y * width + x] = dist
        this.falloff[y * width + x] = Math.max(0, 1 - (dist / (reach * 0.85)) ** 2)
      }
    }
  }

  /** Sets peak (white core) and glow (primary tint) for a logo half-cell at dist from the logo centre. */
  private logoPulse(dist: number) {
    let peak = 0.04
    let glow = 0
    for (let i = 0; i < 2; i++) {
      const delta = dist - this.logoHeads[i]!
      const core = Math.exp(-(Math.abs(delta / 1.2) ** 1.8))
      const soft = Math.exp(-(Math.abs(delta / 7) ** 1.6))
      const tail = delta < 0 && delta > -7 ? (1 + delta / 7) ** 2.6 : 0
      peak += core * 0.65 * this.logoEased[i]!
      glow += (soft * 0.16 + tail * 0.22) * this.logoEased[i]!
    }
    this.peak = Math.min(1, peak)
    this.glow = Math.min(1, glow)
  }

  private logoTint(out: RGBA, base: RGBA, glow: number, peak: number) {
    return mix(out, mix(out, base, this._primary, glow), this.white, peak)
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    const width = this.width
    const height = this.height
    if (!this.visible || this.isDestroyed || width <= 0 || height <= 0) return
    // Without its own frame buffer (not yet sized) there is nothing safe to write into directly.
    if (buffer !== this.frameBuffer) return
    const t = this.elapsed
    const rgb = this._ctx.capabilities?.rgb === true
    const logoX = Math.max(0, Math.floor((width - LOGO_WIDTH) / 2))
    const rawLogoY = this.anchor ? this.anchor.screenY - this.screenY : Math.round((height - LOGO_HEIGHT) / 2) - 1
    const logoY = Math.max(0, Math.min(Math.max(0, height - LOGO_HEIGHT), rawLogoY))
    this.field(width, height, logoX, logoY)
    // The frame buffer keeps the last frame, so a still frame is drawn once.
    const drawnKey = this._animate ? "" : `${this.fieldKey}:${rgb}`
    if (drawnKey && drawnKey === this.drawnKey) return
    const breath = (0.5 + 0.5 * Math.sin(t * BREATH_SPEED)) * BREATH_AMP
    for (let ring = 0; ring < RINGS; ring++) {
      const phase = (t / PERIOD + ring / RINGS - PHASE_OFFSET + 1) % 1
      this.ringHeads[ring] = phase * this.reach
      this.ringEased[ring] = ease(phase)
    }
    const logoPhase0 = (t / PERIOD) % 1
    const logoPhase1 = (t / PERIOD + 0.5) % 1
    this.logoHeads[0] = logoPhase0 * LOGO_REACH
    this.logoHeads[1] = logoPhase1 * LOGO_REACH
    this.logoEased[0] = ease(logoPhase0)
    this.logoEased[1] = ease(logoPhase1)
    mix(this.shadow, this._background, this._logoBase, 0.25)

    buffer.withBuffers((cells) => {
      const stride = cells.width
      const rows = Math.min(height, cells.height)
      const cols = Math.min(width, stride)
      const { char, fg, bg, attributes } = cells
      for (let y = 0; y < rows; y++) {
        const ly = y - logoY
        const inLogoRow = ly >= 0 && ly < LOGO_HEIGHT
        for (let x = 0; x < cols; x++) {
          const field = y * width + x
          const dist = this.dist[field]!
          let level = 0
          for (let ring = 0; ring < RINGS; ring++) {
            const delta = dist - this.ringHeads[ring]!
            const crest = Math.abs(delta) < WIDTH ? 0.5 + 0.5 * Math.cos((delta / WIDTH) * Math.PI) : 0
            const tail = delta < 0 && delta > -TAIL ? (1 + delta / TAIL) ** 2.3 : 0
            level += (crest * AMP + tail * TAIL_AMP) * this.ringEased[ring]!
          }
          mix(
            this.pulse,
            this._background,
            this._primary,
            Math.min(1, (level / RINGS + breath) * this.falloff[field]!) * 0.7,
          )

          const cell = y * stride + x
          const color = cell * 4
          const lx = x - logoX
          const logo = inLogoRow && lx >= 0 && lx < LOGO_WIDTH ? ly * LOGO_WIDTH + lx : -1
          const glyph = logo < 0 ? Glyph.None : (LOGO_GLYPH[logo]! as Glyph)
          if (glyph === Glyph.None) {
            char[cell] = SPACE
            put(fg, color, this.pulse)
            put(bg, color, this.pulse)
            attributes[cell] = 0
            continue
          }
          attributes[cell] = LOGO_ATTRIBUTES[logo]!
          this.logoPulse(LOGO_TOP_DIST[logo]!)
          const topPeak = this.peak
          const topGlow = this.glow
          this.logoPulse(LOGO_BOTTOM_DIST[logo]!)
          const bottomPeak = this.peak
          const bottomGlow = this.glow
          if (glyph === Glyph.Shadow) {
            mix(this.bg, this.shadow, this.white, Math.max(topPeak, bottomPeak) * 0.18)
            char[cell] = SPACE
            put(fg, color, this.bg)
            put(bg, color, this.bg)
          } else if (glyph === Glyph.ShadowTop) {
            this.logoTint(this.fg, this._logoBase, topGlow, topPeak)
            mix(this.bg, this.shadow, this.white, bottomPeak * 0.18)
            char[cell] = UPPER_HALF
            put(fg, color, this.fg)
            put(bg, color, this.bg)
          } else if (glyph === Glyph.ShadowBottom) {
            mix(this.fg, this.shadow, this.white, topPeak * 0.18)
            char[cell] = UPPER_HALF
            put(fg, color, this.fg)
            put(bg, color, this.pulse)
          } else if (glyph === Glyph.Block && rgb) {
            this.logoTint(this.fg, this._logoBase, topGlow, topPeak)
            this.logoTint(this.bg, this._logoBase, bottomGlow, bottomPeak)
            char[cell] = UPPER_HALF
            put(fg, color, this.fg)
            put(bg, color, this.bg)
          } else {
            this.logoTint(this.fg, this._logoBase, (topGlow + bottomGlow) / 2, (topPeak + bottomPeak) / 2)
            char[cell] = LOGO_CHAR[logo]!
            put(fg, color, this.fg)
            put(bg, color, this.pulse)
          }
        }
      }
    })
    this.drawnKey = drawnKey
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    go_upsell_art: typeof GoUpsellArtRenderable
  }
}

extend({ go_upsell_art: GoUpsellArtRenderable })
