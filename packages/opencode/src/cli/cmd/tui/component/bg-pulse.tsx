import {
  FrameBufferRenderable,
  OptimizedBuffer,
  RGBA,
  TextAttributes,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { go } from "@/cli/logo"
import { tint, useTheme } from "@tui/context/theme"

const PERIOD = 4600
const RINGS = 3
const WIDTH = 3.8
const TAIL = 9.5
const AMP = 0.55
const TAIL_AMP = 0.16
const BREATH_AMP = 0.05
const BREATH_SPEED = 0.0008
// Offset so the bg ring emits from the estimated GO center when the logo shimmer peaks.
const PHASE_OFFSET = 0.29
const LOGO_GAP = 1
const LOGO_TOP_BIAS = -1
const LOGO_LEFT_WIDTH = go.left[0]?.length ?? 0
const LOGO_LINES = go.left.map((line, index) => line + " ".repeat(LOGO_GAP) + go.right[index])
const LOGO_WIDTH = LOGO_LINES[0]?.length ?? 0
const LOGO_HEIGHT = LOGO_LINES.length
const SPACE = " ".codePointAt(0)!
const TOP_HALF = "▀".codePointAt(0)!
const FULL_BLOCK = "█".codePointAt(0)!

type Rgb = [number, number, number]

type GoUpsellArtOptions = RenderableOptions<FrameBufferRenderable> & {
  backgroundPanel?: RGBA
  primary?: RGBA
  logoBase?: RGBA
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, n))
}

function toRgb(color: RGBA): Rgb {
  const [r, g, b] = color.toInts()
  return [r, g, b]
}

function writeRgb(buffer: Uint16Array, offset: number, r: number, g: number, b: number, a = 255) {
  buffer[offset] = r
  buffer[offset + 1] = g
  buffer[offset + 2] = b
  buffer[offset + 3] = a
}

function mixChannel(base: number, overlay: number, alpha: number) {
  return Math.round(base + (overlay - base) * clamp(alpha))
}

function writeTint(buffer: Uint16Array, offset: number, base: Rgb, overlay: Rgb, alpha: number) {
  writeRgb(
    buffer,
    offset,
    mixChannel(base[0], overlay[0], alpha),
    mixChannel(base[1], overlay[1], alpha),
    mixChannel(base[2], overlay[2], alpha),
  )
}

function writeLogoTint(buffer: Uint16Array, offset: number, base: Rgb, primary: Rgb, primaryMix: number, peakMix: number) {
  const p = clamp(primaryMix)
  const q = clamp(peakMix)
  const r = mixChannel(mixChannel(base[0], primary[0], p), 255, q)
  const g = mixChannel(mixChannel(base[1], primary[1], p), 255, q)
  const b = mixChannel(mixChannel(base[2], primary[2], p), 255, q)
  writeRgb(buffer, offset, r, g, b)
}

function sameRgb(a: Rgb, b: Rgb) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

class GoUpsellArtRenderable extends FrameBufferRenderable {
  private panelRgb: Rgb = [0, 0, 0]
  private primaryRgb: Rgb = [255, 255, 255]
  private logoBaseRgb: Rgb = [180, 180, 180]
  private elapsed = 0
  private distances = new Float32Array(0)
  private edgeFalloff = new Float32Array(0)
  private geometryWidth = 0
  private geometryHeight = 0
  private reach = 1
  private logoX = 0
  private logoY = 0

  constructor(ctx: RenderContext, options: GoUpsellArtOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1
    const height = typeof options.height === "number" ? options.height : 1
    super(ctx, {
      ...options,
      width,
      height,
      live: options.live ?? true,
      respectAlpha: false,
    })

    if (options.width !== undefined && typeof options.width !== "number") this.width = options.width
    if (options.height !== undefined && typeof options.height !== "number") this.height = options.height
    if (options.backgroundPanel) this.panelRgb = toRgb(options.backgroundPanel)
    if (options.primary) this.primaryRgb = toRgb(options.primary)
    if (options.logoBase) this.logoBaseRgb = toRgb(options.logoBase)
  }

  set backgroundPanel(value: RGBA | undefined) {
    if (!value) return
    const next = toRgb(value)
    if (sameRgb(this.panelRgb, next)) return
    this.panelRgb = next
    this.requestRender()
  }

  set logoBase(value: RGBA | undefined) {
    if (!value) return
    const next = toRgb(value)
    if (sameRgb(this.logoBaseRgb, next)) return
    this.logoBaseRgb = next
    this.requestRender()
  }

  set primary(value: RGBA | undefined) {
    if (!value) return
    const next = toRgb(value)
    if (sameRgb(this.primaryRgb, next)) return
    this.primaryRgb = next
    this.requestRender()
  }

  protected override onResize(width: number, height: number): void {
    super.onResize(width, height)
    this.rebuildGeometry(width, height)
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    if (!this.visible || this.isDestroyed) return

    this.elapsed = (this.elapsed + deltaTime) % PERIOD
    this.rebuildGeometry(this.frameBuffer.width, this.frameBuffer.height)
    this.drawBackground(this.elapsed)
    this.drawLogo(this.elapsed)
    super.renderSelf(buffer)
  }

  private rebuildGeometry(width: number, height: number) {
    if (width === this.geometryWidth && height === this.geometryHeight) return

    this.geometryWidth = width
    this.geometryHeight = height
    this.logoX = Math.max(0, Math.floor((width - LOGO_WIDTH) / 2))
    this.logoY = Math.max(
      0,
      Math.min(Math.max(0, height - LOGO_HEIGHT), Math.round((height - LOGO_HEIGHT) / 2) + LOGO_TOP_BIAS),
    )

    const centerX = this.logoX + LOGO_WIDTH / 2
    const centerY = this.logoY + LOGO_HEIGHT / 2
    this.reach = Math.hypot(Math.max(centerX, width - centerX), Math.max(centerY, height - centerY) * 2) + TAIL
    this.distances = new Float32Array(width * height)
    this.edgeFalloff = new Float32Array(width * height)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x
        const dist = Math.hypot(x + 0.5 - centerX, (y + 0.5 - centerY) * 2)
        this.distances[index] = dist
        this.edgeFalloff[index] = Math.max(0, 1 - (dist / (this.reach * 0.85)) ** 2)
      }
    }
  }

  private drawBackground(t: number) {
    const buffers = this.frameBuffer.buffers
    const heads = [0, 0, 0]
    const eased = [0, 0, 0]
    const breath = (0.5 + 0.5 * Math.sin(t * BREATH_SPEED)) * BREATH_AMP

    for (let i = 0; i < RINGS; i++) {
      const phase = (t / PERIOD + i / RINGS - PHASE_OFFSET + 1) % 1
      const envelope = Math.sin(phase * Math.PI)
      eased[i] = envelope * envelope * (3 - 2 * envelope)
      heads[i] = phase * this.reach
    }

    for (let index = 0; index < this.distances.length; index++) {
      let level = 0
      for (let i = 0; i < RINGS; i++) {
        const delta = this.distances[index] - heads[i]
        const crest = Math.abs(delta) < WIDTH ? 0.5 + 0.5 * Math.cos((delta / WIDTH) * Math.PI) : 0
        const tail = delta < 0 && delta > -TAIL ? (1 + delta / TAIL) ** 2.3 : 0
        level += (crest * AMP + tail * TAIL_AMP) * eased[i]
      }

      const strength = Math.min(1, (level / RINGS + breath) * this.edgeFalloff[index]) * 0.7
      const offset = index * 4
      buffers.char[index] = SPACE
      buffers.attributes[index] = 0
      writeTint(buffers.bg, offset, this.panelRgb, this.primaryRgb, strength)
      writeTint(buffers.fg, offset, this.panelRgb, this.primaryRgb, strength)
    }
  }

  private logoPulse(x: number, pixelY: number, t: number) {
    const centerX = LOGO_WIDTH / 2
    const centerY = LOGO_HEIGHT
    const dist = Math.hypot(x + 0.5 - centerX, pixelY - centerY)
    const reach = Math.hypot(LOGO_WIDTH, LOGO_HEIGHT * 2) + 3
    let peak = 0.04
    let primary = 0

    for (let i = 0; i < 2; i++) {
      const phase = (t / PERIOD + i / 2) % 1
      const envelope = Math.sin(phase * Math.PI)
      const eased = envelope * envelope * (3 - 2 * envelope)
      const delta = dist - phase * reach
      const core = Math.exp(-(Math.abs(delta / 1.2) ** 1.8))
      const soft = Math.exp(-(Math.abs(delta / 7) ** 1.6))
      const tail = delta < 0 && delta > -7 ? (1 + delta / 7) ** 2.6 : 0
      peak += core * 0.65 * eased
      primary += (soft * 0.16 + tail * 0.22) * eased
    }

    return { peak: Math.min(1, peak), primary: Math.min(1, primary) }
  }

  private drawLogo(t: number) {
    if (this.geometryWidth < LOGO_WIDTH || this.geometryHeight < LOGO_HEIGHT) return

    const buffers = this.frameBuffer.buffers
    const shadow: Rgb = [
      mixChannel(this.panelRgb[0], this.logoBaseRgb[0], 0.25),
      mixChannel(this.panelRgb[1], this.logoBaseRgb[1], 0.25),
      mixChannel(this.panelRgb[2], this.logoBaseRgb[2], 0.25),
    ]

    for (let y = 0; y < LOGO_HEIGHT; y++) {
      const line = LOGO_LINES[y]
      for (let x = 0; x < LOGO_WIDTH; x++) {
        const char = line[x]
        if (!char || char === " ") continue

        const cellX = this.logoX + x
        const cellY = this.logoY + y
        const index = cellY * this.geometryWidth + cellX
        const offset = index * 4
        const top = this.logoPulse(x, y * 2, t)
        const bottom = this.logoPulse(x, y * 2 + 1, t)
        buffers.attributes[index] = x > LOGO_LEFT_WIDTH ? TextAttributes.BOLD : 0

        if (char === "_") {
          buffers.char[index] = SPACE
          writeLogoTint(buffers.bg, offset, shadow, this.primaryRgb, 0, Math.max(top.peak, bottom.peak) * 0.18)
          continue
        }

        if (char === "^") {
          buffers.char[index] = TOP_HALF
          writeLogoTint(buffers.fg, offset, this.logoBaseRgb, this.primaryRgb, top.primary, top.peak)
          writeLogoTint(buffers.bg, offset, shadow, this.primaryRgb, 0, bottom.peak * 0.18)
          continue
        }

        if (char === "~") {
          buffers.char[index] = TOP_HALF
          writeLogoTint(buffers.fg, offset, shadow, this.primaryRgb, 0, top.peak * 0.18)
          continue
        }

        if (char === "█" && this._ctx.capabilities?.rgb === true) {
          buffers.char[index] = TOP_HALF
          writeLogoTint(buffers.fg, offset, this.logoBaseRgb, this.primaryRgb, top.primary, top.peak)
          writeLogoTint(buffers.bg, offset, this.logoBaseRgb, this.primaryRgb, bottom.primary, bottom.peak)
          continue
        }

        buffers.char[index] = char === "█" ? FULL_BLOCK : char.codePointAt(0)!
        writeLogoTint(
          buffers.fg,
          offset,
          this.logoBaseRgb,
          this.primaryRgb,
          (top.primary + bottom.primary) / 2,
          (top.peak + bottom.peak) / 2,
        )
      }
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    go_upsell_art: typeof GoUpsellArtRenderable
  }
}

extend({ go_upsell_art: GoUpsellArtRenderable })

export function BgPulse() {
  const { theme } = useTheme()
  const renderer = useRenderer()
  let targetFps = renderer.targetFps
  let maxFps = renderer.maxFps

  onMount(() => {
    targetFps = renderer.targetFps
    maxFps = renderer.maxFps
    renderer.targetFps = 30
    renderer.maxFps = 30
  })

  onCleanup(() => {
    renderer.targetFps = targetFps
    renderer.maxFps = maxFps
  })

  return (
    <go_upsell_art
      width="100%"
      height="100%"
      backgroundPanel={theme.backgroundPanel}
      primary={theme.primary}
      logoBase={tint(theme.background, theme.text, 0.62)}
      live
    />
  )
}
